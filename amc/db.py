
import datetime
import sqlite3

from amc.basic import *
from amc.command import amc_command

def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}

class Amcdb:

    def __init__(self, project_dir, modules=()):
        self.project_dir = project_dir
        self.db = sqlite3.connect(':memory:')
        self.modules = set()
        for module in modules:
            self.use_module(module)

    def use_module(self, module):
        if module not in self.modules:
            self.db.execute(f"ATTACH DATABASE ? AS {module}",
                            (f"{self.project_dir}/data/{module}.sqlite",))
            self.modules.add(module)

    def layout_npages(self):
        self.use_module("layout")
        return self.db.execute("SELECT count(*) FROM layout.layout_page").fetchone()[0]

    def layout_page_add(self, student, page, delta):
        self.use_module("layout")
        while delta < 0:
            if student==1 and page==1:
                s = self.db.execute("SELECT student,page FROM layout.layout_page ORDER BY student DESC, page DESC LIMIT ?", (-delta,)).fetchall()
            else:
                s = self.db.execute("SELECT student,page FROM layout.layout_page WHERE student < ? OR (student = ? AND page < ?) ORDER BY student DESC, page DESC LIMIT ?", (student,student,page,-delta)).fetchall()
            if len(s)==0:
                delta = 0
            else:
                delta += len(s)
                student,page = s[-1]
        while delta > 0:
            s = self.db.execute("SELECT student,page FROM layout.layout_page WHERE student > ? OR (student = ? AND page > ?) ORDER BY student, page LIMIT ?", (student,student,page,delta)).fetchall()
            if len(s)==0:
                s = self.db.execute("SELECT student,page FROM layout.layout_page ORDER BY student, page LIMIT ?", (delta,)).fetchall()
            if len(s)==0:
                delta = 0
            else:
                delta -= len(s)
                student,page = s[-1]
        return student,page
        
    def student_range(self):
        self.use_module("layout")
        return self.db.execute("SELECT min(student), max(student) FROM layout.layout_page").fetchone()

    def capture_pages(self, threshold=None, threshold_up=None):
        self.use_module("capture")
        self.db.row_factory = dict_factory
        sensitivity_values = [ "1" ]
        prop = "cast(z.black as real)/cast(z.total as real)"
        if threshold is not None and threshold>0:
            sensitivity_values.append(f"min(ABS({prop}-{threshold})/{threshold})")
        if threshold_up is not None and threshold_up<1:
            sensitivity_values.append(f"min(ABS({prop}-{threshold_up})/{1-threshold_up})")
        sensitivity = "10 * ( 1 - min(" + ",".join(sensitivity_values) + "))"
        return self.db.execute(f"SELECT p.student,p.page,p.copy,p.timestamp_manual,p.mse,{sensitivity} as sensitivity FROM capture.capture_page as p LEFT JOIN capture.capture_zone as z ON p.student=z.student and p.page=z.page and p.copy=z.copy and z.type=4 GROUP BY p.student,p.page,p.copy ORDER BY p.student,p.copy,p.page").fetchall()

    def page_t_manual(self, student, page, copy):
        self.use_module("capture")
        return self.db.execute("SELECT timestamp_manual FROM capture.capture_page WHERE student=? AND page=? AND copy=?", (student, page, copy)).fetchone()[0]

    def get_zoneid(self, student, page, copy, question, answer):
        self.use_module("capture")
        self.db.execute(
            """INSERT OR IGNORE INTO capture.capture_zone
            (student, page, copy, type, id_a, id_b) VALUES (?,?,?,?,?,?)""",
            (student, page, copy, 4, question, answer))
        self.db.commit()
        return self.db.execute(
            """SELECT zoneid FROM capture.capture_zone
            WHERE student=? AND page=? AND copy=?
              AND type=? AND id_a=? AND id_b=?""",
              (student, page, copy, 4, question, answer)).fetchone()[0]

    def set_manual(self, student, page, copy, question, answer, ticked,
                   uid=None, app=None):
        self.use_module("capture")
        if self.page_t_manual(student, page, copy)==0:
            messages, variables = amc_command(
                uid, "db", "force-manual",
                f"{student}/{page}:{copy}",
            )
            if messages["ERR"]:
                return
            if app:
                app.socketio.emit("allow-revert", to=uid)
        zoneid = self.get_zoneid(student, page, copy, question, answer)
        self.db.execute("UPDATE capture.capture_zone SET manual=? WHERE zoneid=?",
                        ((1 if ticked else 0), zoneid))
        time = int(datetime.datetime.now().timestamp())
        self.db.execute("UPDATE capture.capture_page SET timestamp_manual=? WHERE student=? AND page=? AND copy=?",
                        (time, student, page, copy))
        self.db.commit()

    def revert_manual(self, student, page, copy):
        self.use_module("capture")
        self.db.execute(
            """UPDATE capture.capture_zone SET manual=-1
            WHERE student=? AND page=? AND copy=? AND type=4""",
            (student, page, copy))
        self.db.execute(
            """UPDATE capture.capture_page SET timestamp_manual=0
            WHERE student=? AND page=? AND copy=?""",
            (student, page, copy))
        self.db.commit()

    def page_zooms(self, student, page, copy):
        self.use_module("capture")
        self.db.row_factory = dict_factory
        z = self.db.execute(
            """SELECT id_a, id_b, imagedata,
            cast(black as real)/cast(total as real) as prop
            FROM capture.capture_zone
            WHERE student=? AND page=? AND copy=? AND type=?
                  AND imagedata IS NOT NULL""",
            (student, page, copy, 4)).fetchall()
        return z

    def get_boxes_status(self, student, page, copy,
                         threshold, threshold_up):
        self.use_module("capture")
        self.db.row_factory = dict_factory
        return self.db.execute(
            """SELECT id_a AS question, id_b AS answer, manual,
            CASE WHEN total <= 0 THEN 0
                 WHEN black >= ? * total
                      AND black <= ? * total THEN 1
                 ELSE 0
            END as auto_ticked
            FROM capture.capture_zone
            WHERE student=? AND page=? AND copy=?
            """,
            (threshold, threshold_up,
             student, page, copy)
        ).fetchall()

    def add_student(self, student, photocopy):
        self.use_module("layout")
        self.use_module("capture")
        pages = [ x[0] for x in self.db.execute(
            """SELECT page FROM layout.layout_box
            WHERE role=1 AND student=? GROUP BY page""",
            (student,)).fetchall() ]

        if not pages:
            return None, None

        first_page = min(pages)

        c = self.db.execute("SELECT max(copy) FROM capture.capture_page WHERE student=?",
                            (student,)).fetchone()[0]
        if photocopy:
            if c is not None:
                copy = c + 1
            else:
                copy = 1
        else:
            if c is not None:
                return first_page, 0
            copy = 0

        # create empty manual data capture for all pages for given student

        for page in pages:
            time = 1
            self.db.execute(
                """INSERT INTO capture.capture_page(student, page, copy, timestamp_manual)
                VALUES (?, ?, ?, ?)""",
                (student, page, copy, time))

        self.db.commit()
        return first_page, copy

    def codes_list(self):
        self.use_module("scoring")
        codes = self.db.execute(
            "SELECT DISTINCT code FROM scoring.scoring_code").fetchall()
        return [ x[0] for x in codes ]

    def get_marks(self):
        self.use_module("scoring")
        marks = self.db.execute(
            "SELECT mark FROM scoring.scoring_mark").fetchall()
        maxis = self.db.execute(
            "SELECT DISTINCT max FROM scoring.scoring_mark").fetchall()
        return [ x[0] for x in marks ], [ x[0] for x in maxis ]
        
            
