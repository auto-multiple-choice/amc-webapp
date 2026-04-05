
import datetime
import sqlite3

from basic import *
from command import amc_command

from flask_socketio import emit

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

    def get_variable(self, module, name):
        self.use_module(module)
        self.db.row_factory = None
        x = self.db.execute(
            f"SELECT value FROM {module}.{module}_variables WHERE name=?",
            (name,)).fetchone()
        if x:
            return x[0]
        else:
            return None

    def set_variable(self, module, name, value):
        self.use_module(module)
        self.db.row_factory = None
        self.db.execute(
            f"UPDATE {module}.{module}_variables SET value=? WHERE name=?",
            (value,name))
        self.db.commit()
        
    def layout_npages(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute("SELECT count(*) FROM layout.layout_page").fetchone()[0]

    def capture_npages(self):
        self.use_module("capture")
        self.db.row_factory = None
        return self.db.execute("SELECT count(*) FROM capture.capture_page").fetchone()[0]

    def layout_nassociations(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute("SELECT count(*) FROM layout.layout_association").fetchone()[0]

    def print_timestamp(self):
        return self.get_variable("layout", "print_timestamp")

    def clear_print_timestamp(self):
        self.set_variable("layout", "print_timestamp", None)

    def layout_page_add(self, student, page, delta):
        self.use_module("layout")
        self.db.row_factory = None
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
        self.db.row_factory = None
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
        return self.db.execute(
            f"""SELECT p.student,p.page,p.copy,p.timestamp_manual,p.mse,
              CASE WHEN z.total<0 THEN null
                   ELSE {sensitivity}
              END as sensitivity
            FROM capture.capture_page as p
                 LEFT JOIN capture.capture_zone as z
            ON p.student=z.student and p.page=z.page and p.copy=z.copy
               and z.type=4
            GROUP BY p.student,p.page,p.copy
            ORDER BY p.student,p.copy,p.page""").fetchall()

    def page_t_manual(self, student, page, copy):
        self.use_module("capture")
        self.db.row_factory = None
        return self.db.execute("SELECT timestamp_manual FROM capture.capture_page WHERE student=? AND page=? AND copy=?", (student, page, copy)).fetchone()[0]

    def get_zoneid(self, student, page, copy, question, answer):
        self.use_module("capture")
        self.db.row_factory = None
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
                   app=None):
        self.use_module("capture")
        if self.page_t_manual(student, page, copy)==0:
            messages, variables = amc_command(
                "db", "force-manual",
                f"{student}/{page}:{copy}",
            )
            if messages["ERR"]:
                return
            emit("allow-revert")
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
        self.db.row_factory = None
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
        self.db.row_factory = None
        codes = self.db.execute(
            "SELECT DISTINCT code FROM scoring.scoring_code").fetchall()
        codes = [ x[0] for x in codes ]
        if self.layout_nassociations():
            codes.append('<preassoc>')
        return codes

    def get_marks(self):
        self.use_module("scoring")
        self.db.row_factory = None
        marks = self.db.execute(
            "SELECT mark FROM scoring.scoring_mark").fetchall()
        maxis = self.db.execute(
            "SELECT DISTINCT max FROM scoring.scoring_mark").fetchall()
        return [ x[0] for x in marks ], [ x[0] for x in maxis ]

    def n_graded_students(self):
        self.use_module("scoring")
        self.db.row_factory = None
        x = self.db.execute("SELECT count(*) FROM scoring.scoring_mark").fetchone()
        return x[0]
        
    def n_identifications(self):
        self.use_module("association")
        self.db.row_factory = None
        x = self.db.execute("""
        SELECT count(*) FROM association.association_association
        WHERE manual IS NOT NULL OR auto IS NOT NULL""").fetchone()
        return x[0]

    def clear_associations(self):
        self.use_module("association")
        self.db.execute("DELETE FROM association.association_association")
        self.db.commit()

    def get_assoc_sheets(self):
        self.use_module("association")
        self.use_module("capture")
        self.db.row_factory = None
        return self.db.execute(
            """SELECT p.student, p.copy, a.manual, a.auto
            FROM capture.capture_page as p
                 LEFT JOIN association.association_association as a
            ON p.student=a.student AND p.copy=a.copy
            GROUP BY p.student, p.copy""").fetchall()

    def get_namefield_image(self, student, copy):
        self.use_module("capture")
        self.db.row_factory = None
        x = self.db.execute(
            """SELECT image FROM capture.capture_zone
            WHERE student=? AND copy=? AND type=?""",
            (student, copy, 2)).fetchone()
        if x:
            return x[0]
        else:
            return None
        
    def associate(self, student, copy, student_id):
        self.use_module("association")
        self.db.row_factory = None
        to_rm = list(self.db.execute(
            """SELECT student, copy FROM association.association_association
            WHERE (auto=? AND manual IS NULL) OR manual=?""",
            (student_id, student_id)).fetchall())
        for s,c in to_rm:
            self.db.execute(
                """UPDATE association.association_association
                SET manual=? WHERE student=? AND copy=?""",
                ("",s,c))
        self.db.execute(
            """INSERT OR REPLACE INTO association.association_association
            (student, copy, manual) VALUES (?,?,?)""",
            (student, copy, student_id))
        self.db.commit()
        return to_rm

    def defects_class(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute("SELECT max(class) FROM layout.layout_defects").fetchone()[0];

    def defects(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute("SELECT kind, class, h1, h2 FROM layout.layout_defects").fetchall();
        
    def orientation(self):
        self.use_module("layout")
        self.db.row_factory = None
        rmin, rmax = self.db.execute(
            """SELECT MIN(ratio), MAX(ratio)
            FROM (SELECT CASE WHEN ABS(width)<1 THEN 1
                         ELSE height/width END
                  AS ratio
                  FROM layout.layout_page)
            """).fetchone()
        if rmin > 1.1:
            return "portrait"
        elif rmax < 0.9:
            return "landscape"
        else:
            return ""
