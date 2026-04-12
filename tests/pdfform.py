
from amcweb import AMCWeb

project_name = 'test-pdfform'
print(f"PROJECT: {project_name}")

aw = AMCWeb()

aw.launch().goto_home()
aw.delete_project_if_exists(project_name)
aw.new_project_from_file(
    project_name, "pdfform/qcm.tex")
aw.document_view("sujet", build=True)
aw.upload_scans("pdfform/0001.pdf")
aw.upload_list("pdfform/names.csv")
aw.do_association_manual([
    {"student": "1", "name": "JOJO", "id": "7"},
])
aw.do_grading()
aw.check_marks(
    marks={
        "1": { "Name": "Jojo A",
               "Mark": 15,
               "TICKED:pref": "ABC",
               "TICKED:prez": "A"
              },
    },
    export=True
)
