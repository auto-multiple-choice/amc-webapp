
from amcweb import AMCWeb

project_name = 'test-multiple'
print(f"PROJECT: {project_name}")

aw = AMCWeb()

aw.launch().goto_home()
aw.delete_project_if_exists(project_name)
aw.new_project_from_file(
    project_name, "multiple/s.tex")
aw.document_view("sujet", build=True)
aw.upload_scans("multiple/1.pdf", "multiple/2.pdf", "multiple/3.pdf",
                photocopy=True, multimode="increasing")
aw.do_grading()
aw.check_marks(
    marks={
        "1:1": { "one":1, "two":2 },
        "1:2": { "one":2, "two":0 },
        "1:3": { "one":3, "two":3 },
    },
    export=True
)
