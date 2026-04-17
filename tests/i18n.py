from amcweb import AMCWeb

project_name = 'test-i18n'
print(f"PROJECT: {project_name}")

aw = AMCWeb(lang="fr-FR")

aw.launch().goto_home()
aw.check_text('project-open', 'Ouvrir')
aw.delete_project_if_exists(project_name)
aw.new_project_from_source_content(
    project_name,
    content="""# AMC-TXT source file

* Question simple ou non ?
+ Oui
+ Oui aussi
- Non
- Toujours pas
""")

aw.document_view("sujet", build=True)
aw.read_dialog(err="La question précédente est une question simple mais a 2 réponses correctes")
