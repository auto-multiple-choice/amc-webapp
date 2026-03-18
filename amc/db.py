
import sqlite3

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
