
from amcweb import AMCWeb

project_name = 'test-txt'
print(f"PROJECT: {project_name}")

aw = AMCWeb()

aw.launch().goto_home()
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
aw.upload_project_file("txt/students.csv")
aw.document_view("sujet", build=True)
aw.upload_scans("txt/scans.pdf")
aw.check_scanned_pages(
    [ (2, 1, 0), (3, 1, 0) ]
)
aw.set_options({ "note_max": "100",
                 "note_grain": "0.1",
                 "note_arrondi": "normal" })
aw.do_grading()
aw.do_association_auto()
aw.check_marks(
    marks={
        "2": { "Name": "BOULIX Jojo", "Q001": 1, "Q002": 0 },
        "3": { "Name": "GŁOBIŚ André", "Q001": 0, "Q002": 2 },
    },
    export=True)
aw.set_options({"global:ascii_filenames": True})
aw.do_annotate(model="(ID)")
aw.check_annotated_files("BOULIX_Jojo.pdf", "GLOBIS_Andre.pdf")
aw.set_options({"global:ascii_filenames": False})
aw.do_annotate(model="(N)-(nom)")
aw.check_annotated_files("0002-BOULIX.pdf", "0003-GŁOBIŚ.pdf")

aw.check_from_public(
    { "1024": 33.3, "2048": 66.7 }
)
