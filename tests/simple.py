
from amcweb import AMCWeb

import subprocess

project_name = 'test-simple'
print(f"PROJECT: {project_name}")

aw = AMCWeb()

aw.launch().goto_home()
aw.delete_project_if_exists(project_name)
aw.new_project_from_template(project_name, 'fr:simple',
                             test_emptyname = True)
aw.document_view("sujet", build=True)
aw.document_view("calage")
aw.layout_page('next')
aw.print_to_files(3, 3)
aw.document_view("indiv-solution", build=True)
completed = aw.get_fs_file("DOC-indiv-solution.pdf")
completed_base = completed[:-4]
subprocess.run(["magick", "convert", "-density", "200x200",
                completed, completed_base + ".jpg"])
scans = []
subprocess.run(["magick", "convert", completed_base + "-4.jpg",
                "-rotate", "180", completed_base + "-4r.jpg"])
scans.append(completed_base + "-4r.jpg")
subprocess.run(["magick", "convert", completed_base + "-3.jpg",
                "-rotate", "90", completed_base + "-3r.jpg"])
scans.append(completed_base + "-3r.jpg")
subprocess.run(["magick", "convert", completed_base + "-5.jpg",
                "-rotate", "270", completed_base + "-5r.jpg"])
scans.append(completed_base + "-5r.jpg")

aw.upload_scans(*scans)
aw.check_scanned_page(4, 1)
aw.check_scanned_page(5, 1)
aw.check_scanned_page(6, 1)
aw.do_grading()
aw.check_marks(
    marks={
        "4": { "pref": 3, "prez": 1 },
        "5": { "pref": 3, "prez": 1 },
        "6": { "pref": 3, "prez": 1 },
    },
    export=True)
aw.check_annotated_files("0004.pdf", "0005.pdf", "0006.pdf", annotate=True)

