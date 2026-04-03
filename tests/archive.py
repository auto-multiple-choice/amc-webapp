
from amcweb import AMCWeb

project_name = 'test-archive'
print(f"PROJECT: {project_name}")

aw = AMCWeb()

aw.launch().goto_home()
aw.delete_project_if_exists(project_name)
aw.new_project_from_file(
    project_name, "archive/numerics.zip")
aw.do_grading()
aw.check_marks(
    marks={
        "2": { "Mark": 20, "Name": "Ed TRANGER" },
        "4": { "Mark": 0,  "Name": "Kost DUNORT" },
    },
    export=True
)
