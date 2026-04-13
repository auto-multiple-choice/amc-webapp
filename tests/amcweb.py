
import selenium
from selenium.webdriver.common.by import By
from selenium.webdriver import Keys, ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support.select import Select
from selenium.webdriver.chrome.options import Options

import time
import tempfile
import requests
import os
import sys
import subprocess
import csv
import datetime
from pathlib import Path

cmd_ctrl = Keys.COMMAND if sys.platform == 'darwin' else Keys.CONTROL

class AMCWeb():

    def __init__(self):
        self.project = None
        self.tab = None
        self.base_url = os.environ.get('AMCWEB_BASEURL', "http://127.0.0.1:5000")
        self.sleep_factor = float(os.environ.get(
            'AMC_TESTS_SLEEP_FACTOR', 1))
        if d := os.environ.get('AMC_TESTS_DIR'):
            date = datetime.datetime.now().strftime("%s")
            test = os.path.basename(sys.argv[0])
            self.temp_dir = f"{d}/{date}-{test}"
            Path(self.temp_dir).mkdir(parents=True, exist_ok=True)
        else:
            self.temp_dir = tempfile.mkdtemp(prefix="amcweb-test-")
        print(f"TEMPDIR: {self.temp_dir}")

    def sleep(self, t):
        time.sleep(t * self.sleep_factor)

    def launch(self):
        chrome_options = Options()
        if os.environ.get('AMC_TESTS_HEADLESS'):
            chrome_options.add_argument("--headless=new")
        if os.environ.get('AMC_TESTS_NO_SANDBOX'):
            chrome_options.add_argument("--no-sandbox")
        # Allow all downloads from server:
        chrome_options.add_argument(
            f"--unsafely-treat-insecure-origin-as-secure={self.base_url}")
        chrome_options.add_experimental_option("prefs", {
            "download.default_directory": self.temp_dir,
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
            "safebrowsing.enabled": True
        })

        svc = selenium.webdriver.ChromeService(
            executable_path="/usr/bin/chromedriver")
        self.driver = selenium.webdriver.Chrome(
            options=chrome_options,
            service=svc)
        self.driver.implicitly_wait(5)

        self.tab = "main"

        return self

    def session_id(self):
        return self.driver.get_cookie("amcsession")["value"]

    def click_on(self, element_id):
        self.driver.find_element(By.ID, element_id).click()

    def delete_project_if_exists(self, project_name):
        olds = self.driver.find_elements(By.CSS_SELECTOR, "li.project-name")
        old = [ p for p in olds if p.text == project_name ]
        if old:
            print(f"Delete project {project_name}…")
            self.driver.find_element(By.ID, 'project-delete').click()
            self.sleep(0.5)
            old[0].click()
            alert = WebDriverWait(self.driver, timeout=2).until(
                lambda d : d.switch_to.alert)
            assert 'delete project' in alert.text
            alert.accept()
            self.sleep(1)

    def goto_home(self):
        self.driver.get(self.base_url)
        self.tab = None
        self.sleep(1)
        return self

    def reload(self, tab_name=None):
        self.goto_home()
        if not tab_name:
            tab_name = self.tab
        if tab_name:
            self.goto_tab(tab_name)

    def wait_for_alert(self, check_message=None, accept=True):
        wait = WebDriverWait(self.driver, timeout=2)
        alert = wait.until(lambda d : d.switch_to.alert)
        if check_message:
            assert check_message in alert.text
        if accept:
            alert.accept()

    def new_project_from_template(self, project_name, template,
                                  group=True, test_emptyname=False):
        print(f"Create project {project_name} from template {template}…")
        group_name = template.split(":")[0]
        self.driver.find_element(By.ID, 'way-template').click()
        self.sleep(.5)
        if group:
            sel = Select(self.driver.find_element(By.ID, 'template-group'))
            sel.select_by_value(group_name)
            self.sleep(.5)
        self.driver.find_element(By.ID, 't:' + template).click()
        self.sleep(.5)

        create = self.driver.find_element(
            By.XPATH,"//span[ contains (text(), 'Create new' ) ]")

        if test_emptyname:
            create.click()
            self.wait_for_alert(check_message='choose a name')

        self.driver.find_element(By.ID,'new-project-name').send_keys(project_name)
        create.click()
        self.sleep(2)

        self.project_name = project_name
        self.tab = "source"

    def set_source_content(self, content):
        self.goto_tab("source")
        self.driver.find_element(By.ID, "code-code").click()
        ActionChains(self.driver).key_down(cmd_ctrl).send_keys("ax").key_up(cmd_ctrl).perform()
        self.driver.find_element(By.CLASS_NAME, "ace_text-input").send_keys(content)
        self.driver.find_element(By.ID, "source-save").click()
        self.sleep(.5)

    def upload_project_file(self, path):
        self.goto_tab("source")
        self.driver.find_element(By.ID, "source-name").click()
        self.driver.find_element(By.ID, 'project-upload-file').send_keys(os.path.abspath(path))
        self.driver.find_element(By.ID, "source-name").click()
        self.sleep(1)

    def new_project_from_source_content(self, project_name, format="plain", content=""):
        print(f"Create project {project_name} ({format})…")
        self.driver.find_element(By.ID,'new-project-name').send_keys(project_name)
        self.driver.find_element(By.ID, 'way-empty').click()
        sel = Select(self.driver.find_element(By.ID, 'source-type'))
        sel.select_by_value(format)
        self.sleep(.5)
        self.driver.find_element(
            By.XPATH,"//span[ contains (text(), 'Create new' ) ]").click()
        self.sleep(2)

        self.project_name = project_name
        self.tab = "source"

        self.set_source_content(content)

    def new_project_from_file(self, project_name, archive_path):
        print(f"Create project {project_name} from {archive_path}…")
        self.driver.find_element(By.ID,'new-project-name').send_keys(project_name)
        self.driver.find_element(By.ID, 'way-file').click()
        self.driver.find_element(By.ID, 'source-file').send_keys(os.path.abspath(archive_path))
        self.driver.find_element(
            By.XPATH,"//span[ contains (text(), 'Create new' ) ]").click()
        self.sleep(2)

        self.project_name = project_name
        self.tab = "source"
        
    def goto_tab(self, tab_name, force=False):
        if self.tab == tab_name and not force:
            print(f"Already on tab {tab_name}")
        else:
            print(f"Go to tab {tab_name}…")
            self.driver.find_element(By.ID, 'menu-' + tab_name).click()
            self.tab = tab_name

    def document_view(self, doc_type, build=False):
        print(f"Looking at document {doc_type}…")
        self.goto_tab("source")
        sel = Select(self.driver.find_element(By.ID, 'doc-type'))
        sel.select_by_value(doc_type)
        self.sleep(2)
        if build:
            self.driver.find_element(By.ID, 'doc-update').click()
            self.sleep(2)
        
    def layout_page(self, action):
        self.click_on('layout-page-' + action)
        self.sleep(2)

    def print_menu(self):
        print("Open print menu…")
        self.document_view("sujet")
        self.click_on('doc-print-btn')
        self.sleep(.5)
    
    def check_downloaded(self, filename):
        path = self.temp_dir + "/" + filename
        assert os.path.isfile(path), f"Missing downloaded file {path}…"
        return path

    def print_to_files(self, first_page=1, last_page=None):
        print("Print to files…")
        self.print_menu()
        if first_page:
            val = self.driver.find_element(By.ID, 'student1')
            val.clear()
            val.send_keys(str(first_page))
        if last_page:
            val = self.driver.find_element(By.ID, 'student2')
            val.clear()
            val.send_keys(str(last_page))
        self.click_on('print-files-btn')
        self.sleep(3)
        path = self.check_downloaded("printed.zip")
        self.goto_home()
        return path
        
    def get_fs_file(self, path, local_filename=None):
        print(f"Download {path}…")
        if local_filename is None:
            local_filename = path
        r = requests.get(f"{self.base_url}/fs/{self.project_name}/{path}",
                         cookies={ "amcsession": self.session_id() })
        assert r.status_code == 200
        local_path = self.temp_dir + "/" + local_filename
        with open(local_path, "wb") as f:
            f.write(r.content)
        return local_path

    def upload_scans(self, *paths):
        print("Uploading scans…")
        txt = "\n".join([ os.path.abspath(p) for p in paths ])
        self.goto_tab("scans")
        self.driver.find_element(By.ID, 'scans-upload').send_keys(txt)
        self.sleep(2 * len(paths))

    def upload_list(self, path):
        print("Uploading students list…")
        self.goto_tab("grading")
        self.driver.find_element(By.ID, 'students-upload').send_keys(os.path.abspath(path))
        self.sleep(2)

    def scanned_pages_list(self):
        tbody = self.driver.find_element(By.ID, 'scans-pages-rows')
        rows = tbody.find_elements(By.XPATH, '*')
        pages = []
        for r in rows:
            p = {}
            for k in ("student", "copy", "page", "manual", "mse", "sens"):
                p[k] = r.get_attribute("amc-" + k)
            pages.append(p)
        return pages

    def check_scanned_pages(self, pages_to_check):
        print(f"Checking for scanned pages {pages_to_check}…")
        pages = self.scanned_pages_list()
        for p in pages:
            print(f"Page: {p}")
            pages_to_check.remove(
                (int(p.get("student",0)),
                 int(p.get("page"),0),
                 int(p.get("copy"),0))
            )
        if pages_to_check:
            raise RuntimeError(f"Scanned pages not found: {pages_to_check}")

    def do_grading(self):
        print("Grading…")
        self.goto_tab("grading")
        self.click_on("do-mark")
        self.sleep(2)

    def do_association_auto(self):
        self.click_on('do-association-auto')
        self.sleep(1)
        w = self.driver.find_element(By.ID, 'warn-panel')
        w.find_element(By.CLASS_NAME, "btn").click()

    def do_association_manual(self, assoc):
        self.goto_tab("grading")
        self.driver.find_element(By.ID, 'do-association-manual').click()
        self.sleep(.5)
        sheets = self.driver.find_element(By.ID, 'assoc-sheets')
        slist = self.driver.find_element(By.ID, 'students-list')
        for student in assoc:
            print(f'Click on student {student["student"]}')
            tr = sheets.find_element(By.XPATH, f'//tr[@amc-student="{student["student"]}"]')
            tr.click()
            self.sleep(1)
            if student.get("name"):
                text = sheets.find_element(By.XPATH, '//div[@class="sheetnum"]/div').text
                print(f"Found {text}")
                if text != student["name"]:
                    raise RuntimeError(f'Can\'t see name {student["name"]} (instead: {text})')
            slist.find_element(By.XPATH, f'//li[@amc-id="{student["id"]}"]').click()
            self.sleep(.5)
        self.driver.find_element(By.ID, 'assoc-manual-done').click()

    def do_export(self, **options):
        print("Export marks…")
        self.goto_tab("grading")

        sel = Select(self.driver.find_element(By.ID, 'format_export'))
        sel.select_by_value(options.get('format', 'CSV'))

        sel = Select(self.driver.find_element(By.ID, 'export_csv_ticked'))
        sel.select_by_value(options.get('csv_ticked', 'AB'))

        self.click_on("do-export")
        self.sleep(2)

    def check_marks(self, marks={}, export=False):
        if export:
            self.do_export(format='CSV')

        filename = "marks.csv"
        self.goto_tab("grading")
        e = self.driver.find_element(By.ID, 'exported-files')
        files = { f.text: f for f in e.find_elements(By.CSS_SELECTOR, "a.filename") }
        if not files.get(filename):
            raise RuntimeError(f"Can't find '{filename}' on the server")

        files[filename].click()
        self.sleep(1)
        path = self.check_downloaded(filename)

        self.reload()

        grades = csv.DictReader(open(path))
        errors = []
        for g in grades:
            student = str(g["Exam"])
            s = marks.get(student)
            if s:
                for k,v in s.items():
                    computed = g.get(k)
                    expected = v
                    if k != "Name" and not k.startswith("TICKED:"):
                        expected = float(expected)
                        computed = None if computed is None else float(computed) 
                    if expected == computed:
                        print(f"Right mark: for student {student}: {k} = {v}")
                    else:
                        errors.append(
                            f"{v}\nWrong mark for student {student}: {k} = {computed} but should be {expected}")
                del(marks[student])
        for k,v in marks.items():
            errors.append(f"Missing grades for {k}, should be {v}")
        if errors:
            print(f"Wrong marks from {filename}:")
            for e in errors:
                print(e)
            raise RuntimeError("Wrong marks")

    def do_annotate(self, **options):
        print("Annotating…")
        self.goto_tab("grading")

        sel = Select(self.driver.find_element(By.ID, 'regroupement_type'))
        sel.select_by_value(options.get('type', 'STUDENTS'))

        model = self.driver.find_element(By.ID, 'modele_regroupement')
        model.clear()
        model.send_keys(options.get('model', ''))

        self.click_on("do-annotate")
        self.sleep(2)

    def check_annotated_files(self, *files, annotate=False):
        if annotate:
            self.do_annotate()
        else:
            self.goto_tab("grading")

        a = self.driver.find_element(By.ID, 'annotated-files')
        annotated_files = { f.text: f
                            for f in a.find_elements(By.CSS_SELECTOR, "a.filename") }

        missing = set(files) - set(annotated_files.keys())
        if missing:
            raise RuntimeError(f"Missing annotated files: {missing}")
        print(f"Annotated files: {list(annotated_files.keys())}")

        for filename in files:
            annotated_files[filename].click()
            self.sleep(1)
            self.check_downloaded(filename)

        self.reload()

    def set_options(self, options):
        self.goto_tab("config")
        for k,v in options.items():
            element = self.driver.find_element(By.ID, k)
            if v==True:
                if not element.is_selected():
                    element.click()
            elif v==False:
                if element.is_selected():
                    element.click()
            else:
                e.clear()
                e.send_keys(v)
        self.sleep(1)
