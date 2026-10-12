
import re
import datetime
import sqlite3

from basic import *
from command import amc_command

from flask import current_app

def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}

class Amcdb:

    def __init__(self, project_dir, modules=()):
        self.project_dir = project_dir
        self.db = sqlite3.connect(':memory:')
        self.modules = set()
        for module in modules:
            self.use_module(module)

    def commit(self):
        self.db.commit()

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

    def set_variable_nocommit(self, module, name, value):
        self.use_module(module)
        self.db.execute(
            f"""INSERT OR REPLACE INTO {module}.{module}_variables (name, value)
            VALUES (?,?)""", (name, value))
        
    def set_variable(self, module, name, value):
        self.set_variable_nocommit(module, name, value)
        self.db.commit()

    def npages_max(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute("SELECT max(page) FROM layout.layout_page").fetchone()[0]

    def first_page(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute("SELECT student, page FROM layout.layout_page ORDER BY student,page LIMIT 1").fetchone()

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

    def n_copies(self):
        self.use_module("capture")
        self.db.row_factory = None
        return self.db.execute(
            """SELECT COUNT(*) FROM
            ( SELECT student,copy FROM capture.capture_page
               WHERE timestamp_auto>0 OR timestamp_manual>0
               GROUP BY student,copy)
            """).fetchone()[0]

    def missing_pages(self):
        self.use_module("layout")
        self.use_module("capture")
        self.db.row_factory = None
        # [missingPages]
        return self.db.execute(
            """SELECT enter.student AS student, enter.page AS page,
                      capture.capture_page.copy AS copy
            FROM ( SELECT student,page FROM layout.layout_box WHERE role=1
                   UNION
                   SELECT student,page FROM layout.layout_zone) AS enter,
                capture.capture_page
            ON enter.student=capture.capture_page.student
            EXCEPT SELECT student,page,copy FROM capture.capture_page
            ORDER BY student,copy,page
            """).fetchall()

    def counts(self):
        missing = self.missing_pages()
        incomplete = set([ (p[0], p[2]) for p in missing ])
        n_incomplete = len(incomplete)
        n_complete = self.n_copies() - n_incomplete
        return n_complete, n_incomplete, missing

    def n_failed(self):
        self.use_module("capture")
        self.db.row_factory = None
        return self.db.execute(
            "SELECT count(*) FROM capture.capture_failed").fetchone()[0]

    def failed_scans(self):
        self.use_module("capture")
        self.db.row_factory = None
        return self.db.execute(
            "SELECT filename, timestamp FROM capture.capture_failed"
            ).fetchall()

    def failed_delete(self, filename):
        self.use_module("capture")
        self.db.execute(
            "DELETE FROM capture.capture_failed WHERE filename=?",
            (filename,))
        self.db.commit()
        return self.n_failed()
    
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
                   all_page=True):
        self.use_module("capture")
        if all_page and self.page_t_manual(student, page, copy)==0:
            messages, variables = amc_command(
                "db", "force-manual",
                f"{student}/{page}:{copy}",
            )
            if messages["ERR"]:
                return
            emit_msg("allow-revert")
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
            WHERE type=? AND student=? AND page=? AND copy=?
            """,
            (threshold, threshold_up,
             4,
             student, page, copy)
        ).fetchall()

    def add_student(self, student, photocopy):
        self.use_module("layout")
        self.use_module("capture")
        self.db.row_factory = None

        force_copy = None
        if ":" in student:
            student, force_copy = student.split(":", 1)
            force_copy = int(force_copy)
        student = int(student)
        
        pages = [ x[0] for x in self.db.execute(
            """SELECT page FROM layout.layout_box
            WHERE role=1 AND student=? GROUP BY page""",
            (student,)).fetchall() ]

        if not pages:
            return student, None, None

        c = self.db.execute(
            """SELECT max(copy)
            FROM capture.capture_page
            WHERE student=?""",
            (student,)).fetchone()[0]

        if force_copy is not None:
            copy = force_copy if photocopy else 0
        elif photocopy:
            if c is not None:
                copy = c + 1
            else:
                copy = 1
        else:
            copy = 0

        # create empty manual data capture for all pages for given student

        existing = [ x[0] for x in self.db.execute(
            """SELECT page FROM capture.capture_page
            WHERE student=? AND copy=?""",
            (student,copy)).fetchall() ]

        missing = set(pages) - set(existing)
        if missing:
            first_page = min(missing)
        else:
            first_page = min(pages)

        for page in pages:
            time = 1
            self.db.execute(
                """INSERT OR IGNORE INTO capture.capture_page(student, page, copy, timestamp_manual)
                VALUES (?, ?, ?, ?)""",
                (student, page, copy, time))

        self.db.commit()
        return student, first_page, copy

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

    def associated_marks(self):
        self.use_module("association")
        self.use_module("scoring")
        self.db.row_factory = None
        return self.db.execute(
            """SELECT studentid, mark, total
            FROM ( SELECT student, copy,
                       CASE WHEN manual IS NOT NULL THEN manual
                            ELSE auto END
                       AS studentid
                   FROM association.association_association ) AS a,
                 scoring.scoring_mark AS m
            ON a.student=m.student AND a.copy=m.copy
            WHERE studentid IS NOT NULL
            """).fetchall()

    def n_graded_students(self):
        self.use_module("scoring")
        self.db.row_factory = None
        x = self.db.execute("SELECT count(*) FROM scoring.scoring_mark").fetchone()
        return x[0]

    def n_real_identifications(self):
        self.use_module("association")
        self.db.row_factory = None
        x = self.db.execute(
            """SELECT count(*) FROM (
                  SELECT CASE WHEN manual IS NOT NULL THEN manual
                              ELSE auto END AS realid
                    FROM association_association
                    WHERE realid IS NOT NULL AND realid != ""
               )""").fetchone()
        return x[0]
        
    def n_identifications(self, manual=True, auto=True):
        self.use_module("association")
        self.db.row_factory = None
        sql = "SELECT count(*) FROM association.association_association"

        cond = []
        if manual:
            cond.append('(manual IS NOT NULL AND manual != "")')
        if auto:
            cond.append('(auto IS NOT NULL AND auto != "")')
        if cond:
            sql += " WHERE " + " OR ".join(cond)

        x = self.db.execute(sql).fetchone()
        return x[0]

    def clear_associations(self):
        self.use_module("association")
        self.db.execute("DELETE FROM association.association_association")
        self.set_variable_nocommit("association", "key_in_list", None)
        self.set_variable_nocommit("association", "code", None)
        self.db.commit()
        self.annotate_source_change()

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
        
    def associate(self, student, copy, student_id, multiple_copies=False):
        self.use_module("association")
        self.db.row_factory = None
        to_rm = []
        if not multiple_copies:
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
        self.annotate_source_change()
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

    def questions_with_textpos(self):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute(
            """SELECT b.question, q.name
            FROM layout.layout_box AS b, layout.layout_question AS q
            ON b.question=q.question
            WHERE b.role=102
            GROUP BY b.question"""
            ).fetchall()

    def pages_with_question(self, question_number):
        self.use_module("layout")
        self.db.row_factory = None
        return self.db.execute(
            """SELECT student, page
            FROM layout.layout_box
            WHERE role=102 AND question=?""",
            (int(question_number),)).fetchall()

    def code_digit_pattern(self):
        codedigit = self.get_variable("layout", "build:codedigit")
        if codedigit == "squarebrackets":
            return r'\[(\d+)\]$'
        else:
            return r'\.(\d+)$'

    def indicative_questions(self):
        cd_re = re.compile(self.code_digit_pattern())
        self.use_module("scoring")
        self.db.row_factory = None
        q = self.db.execute(
            """SELECT t.question, t.title
            FROM scoring.scoring_question AS q, scoring.scoring_title AS t
            ON q.question = t.question
            WHERE q.indicative=1
            GROUP BY t.question""").fetchall()
        q = filter(lambda x: not cd_re.search(x[1]), q)
        return list(q)
        
    def groupsep_available(self):
        self.use_module("scoring")
        self.db.row_factory = None
        questions = self.db.execute(
            "SELECT title FROM scoring.scoring_title").fetchall()
        sep_ok = []
        for sep in (":", "."):
            groups = set()
            ok = False
            for q in questions:
                x = q[0].split(sep, 1)
                if len(x) == 2:
                    if x[0] in groups:
                        ok = True
                    else:
                        groups.add(x[0])
            if ok:
                sep_ok.append(sep)
        return sep_ok

    def delete_scan_page_data(self, student, page, copy):
        self.use_module("capture")
        self.db.row_factory = None
        files_to_rm = []

        # getScanPage+NOT NULL
        files = self.db.execute(
            """SELECT src
            FROM capture.capture_page
            WHERE student=? AND page=? AND copy=?
            AND src IS NOT NULL
            """, (student, page, copy)).fetchall()
        files_to_rm += [ f[0] for f in files ]

        # getLayout+NOT NULL
        files = self.db.execute(
            """SELECT layout_image FROM capture.capture_page
            WHERE student=? AND page=? AND copy=?
            AND layout_image IS NOT NULL
            """, (student, page, copy)).fetchall()
        files_to_rm += [ "%PROJET/cr/" + f[0]
                         for f in files ]

        # delete files
        for f in project_paths_absolute(files_to_rm):
            current_app.logger.info(f"Delete file: {f}")
            try:
                os.unlink(f)
            except Exception as e:
                current_app.logger.error(f"Can't remove file {f}: {str(e)}")
              
        # deletePagePositions
        self.db.execute(
            """DELETE FROM capture.capture_position
            WHERE zoneid IN
            ( SELECT zoneid FROM capture.capture_zone
              WHERE student=? AND page=? AND copy=? )
            """, (student, page, copy))
        # deletePageZones
        self.db.execute(
            """DELETE FROM capture.capture_zone
            WHERE student=? AND page=? AND copy=?
            """, (student, page, copy))
        # deletePage
        self.db.execute(
            """DELETE FROM capture.capture_page
            WHERE student=? AND page=? AND copy=?
            """, (student, page, copy))

    def annotate_source_change(self):
        now = int(datetime.datetime.now().timestamp())
        current_app.logger.debug(f"Annotate source has changed! Time={now}")
        self.set_variable("capture", "annotate_source_change", now)
