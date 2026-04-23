
from amcweb import AMCWeb

import os

project_name = 'test-user'
print(f"PROJECT: {project_name}")

aw = AMCWeb(user_header=os.environ.get("AMC_USERHEADER", "Test-User"))

aw.launch().set_user("jojo")
aw.delete_project_if_exists(project_name)

aw.set_user("chloe")
aw.check_admin_search(status=True)
aw.delete_project_if_exists(project_name)

aw.new_project_from_source_content(
    project_name,
    content="""# AMC-TXT source file
PaperSize: A4
Title: My first AMC questionnaire
Code:4

Presentation: Please answer the following questions
the best you can.

* What is the capital city of Cameroon?
+ Yaounde
- Douala
- Kribi

** From the following numbers, which are positive?
- -2
+ 2
+ 10
""")

aw.upload_project_file("user/all.csv")
aw.document_view("sujet", build=True)
aw.upload_scans("user/chloe.pdf")
aw.check_scanned_pages(
    [ (4, 1, 0) ]
)
aw.set_options({ "note_max": "100",
                 "note_grain": "0.1",
                 "note_arrondi": "normal" })
aw.do_grading()
aw.do_association_auto()
aw.check_marks(
    marks={
        "4": { "Q001": 1, "Q002": 1 },
        },
    export=True
)
aw.check_from_public(
    { "1234": 66.7 }
)

aw.quit()

aw = AMCWeb(user_header=os.environ.get("AMC_USERHEADER", "Test-User"))

aw.launch().set_user("jojo")
assert project_name not in aw.projects_list()
aw.check_admin_search(status=False)

aw.new_project_from_template(project_name, 'fr:simple')
aw.document_view("sujet", build=True)
aw.upload_scans("user/jojo.pdf")

aw.check_scanned_pages(
    [ (7, 1, 0) ], pages_must_be_missing=[ (4, 1, 0) ]
)
aw.set_options({ "note_max": "20",
                 "note_grain": "1",
                 "note_arrondi": "normal" })

aw.do_grading()
aw.check_marks(
    marks={
        "7": { "prez": 1, "pref": 2 },
        },
    export=True
)

aw.quit()

aw = AMCWeb(user_header=os.environ.get("AMC_USERHEADER", "Test-User"))

aw.launch().set_user("chloe")

aw.switch_user("jojo", project_name)
aw.check_options({ "note_max": "20" })
aw.upload_scans("user/jojo2.pdf")
aw.check_scanned_pages(
    [ (7, 1, 0), (5, 1, 0) ], pages_must_be_missing=[ (4, 1, 0) ]
)
aw.do_grading()
aw.upload_list("user/e.csv")
aw.do_association_manual([
    {"student": "7", "id": "1"},
    {"student": "5", "id": "2" },
    ])
aw.check_marks(
    marks={
        "5": { "Name": "le deuxième" },
        "7": { "Name": "un ami" },
        },
    export=True
)
