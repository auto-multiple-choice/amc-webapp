
from amcweb import AMCWeb

import os
import sys
import subprocess
from multiprocessing import Process, set_start_method
import random

n_users = int(os.environ.get("AMC_TESTS_PROCESSES", 10))

def launch_u(u):
    aw = AMCWeb(
        user_header=os.environ.get("AMC_USERHEADER", "Test-User"),
        random_delay=True, prefix=f"{u}> ",
    )
    aw.extend_sleep_factor(5)
    aw.sleep(5 * random.random())
    aw.launch()

    return aw

def one_user(u):

    aw = launch_u(u)

    aw.set_user(f"jojo{u}")
    aw.goto_home()

    if u % 4 == 0:
        aw.quit()

        aw = launch_u(u)
        
        aw.set_user("chloe")
        aw.goto_home()
        aw.sleep(1)
        aw.switch_user(f"jojo{u}")

    project_name = "test-meeting"
    if u >= 5:
        project_name += str(u)

    aw.delete_project_if_exists(project_name)

    prefill = False

    match u % 4:
        case 0:
            aw.new_project_from_template(project_name, "fr:groupes")
        case 1:
            aw.new_project_from_source_content(
                project_name,
                content="""# AMC-TXT
PaperSize: A4
Title: Excellent exemple

Presentation: Remplissez du moeix que vous pouvez

* De quel pays Tachkent est-elle la capitale ?
+ Ouzbékistan
- Kazakhstan
- France
- Royaume-Uni

* Quel est l'élément de numéro atomique 42 ?
+ Molybdène
- Technétium
- T-rex
- Hydrogène

* Quelle est la longueur, en centimètres, d'un pouce technique international ?
+ 2,54
- 3,45
- 5,42
- 4,25
- π
""")
        case 2:
            aw.new_project_from_file(project_name, "meeting/pre.tgz")
            prefill = True
        case 3:
            aw.new_project_from_file(project_name, "meeting/qcmA.tex")

    if not prefill:
        aw.set_input({"ncopies": 10+u//2})
    aw.document_view("sujet", build=True)
    aw.document_view("calage")
    aw.layout_page('next')

    student = 2 + u % 7
    
    aw.print_to_files(student, student)
    aw.document_view("indiv-solution", build=True)
    completed = aw.get_fs_file("DOC-indiv-solution.pdf")
    completed_base = completed[:-4]
    subprocess.run(["magick", "convert", "-density", "200x200",
                    completed, completed_base + ".jpg"])
    scan = f"{completed_base}-{student-1}.jpg"

    aw.upload_scans(scan)
    aw.check_scanned_pages( [ (student, 1, 0) ] )

    maxi = 10 + 3*u
    aw.set_options({ "note_max": str(maxi),
                     "note_grain": "0.5",
                     "note_arrondi": "normal" })
    
    aw.do_grading()
    aw.check_marks(
        marks = { str(student): { "Mark": maxi } },
        export=True
    )

set_start_method('fork')

processes = []
    
for num in range(n_users):
    p = Process(target=one_user, args=(num,), name=f"AMC-U{num}")
    processes.append(p)
    p.start()

flag = True
while flag:
    flag = False
    for p in processes:
        if p.exitcode == 1:
            for z in processes:
                z.kill()
            sys.exit(1)

        elif p.is_alive():
            flag = True

for p in processes:
    p.join()
