
from amcweb import AMCWeb

project_name = 'test-multicopies'
print(f"PROJECT: {project_name}")

aw = AMCWeb()


aw.launch().goto_home()
aw.delete_project_if_exists(project_name)
aw.new_project_from_file(
    project_name, "multicopies/source.txt")

aw.set_input({"ncopies": 10})
aw.document_view("sujet", build=True)

aw.set_options({
    "multiple_copies": True,
    "global:tolerance_marque_inf": "0.4",
})

scans = [ f"multicopies/p-{n}.png" for n in range(10) ]
aw.upload_scans(*scans)

aw.do_grading()
aw.upload_list("multicopies/students.csv")
aw.do_association_auto()
aw.do_association_manual([ { "student": "4", "id": "12" } ])

aw.check_marks(
    marks={
        "1": { "Name": "Douze" },
        "2": { "Name": "Jojo" },
        "3": { "Name": "Claire" },
        "4": { "Name": "Douze" },
        "5": { "Name": "Pil" },
        "6": { "Name": "Jojo" },
        "7": { "Name": "Six" },
        "8": { "Name": "Jojo" },
        },
    export=True
)
