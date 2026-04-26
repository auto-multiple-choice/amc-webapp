
import selenium
from selenium.webdriver.common.by import By
from selenium.webdriver import Keys, ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support.select import Select
from selenium.webdriver.chrome.options import Options
from selenium.common import NoSuchElementException, ElementNotInteractableException

import time
import tempfile
import requests
import os
import re
import io
import sys
import subprocess
import csv
import datetime
import random
from pathlib import Path

cmd_ctrl = Keys.COMMAND if sys.platform == 'darwin' else Keys.CONTROL

class AMCWeb():

    def __init__(self, lang=None, user_header=None,
                 random_delay=False, prefix=""):
        self.lang = lang
        self.project_name = None
        self.tab = None
        self.user_name = None
        self.fake_user = None
        self.random_delay = random_delay
        self.prefix = prefix
        self.user_header = user_header
        self.base_url = os.environ.get('AMCWEB_BASEURL', "http://127.0.0.1:5000")
        self.sleep_factor = float(os.environ.get(
            'AMC_TESTS_SLEEP_FACTOR', 1))
        self.renew_temp_dir()

    def extend_sleep_factor(self, mult):
        self.sleep_factor *= mult

    def log(self, text):
        print(self.prefix + text)

    def renew_temp_dir(self):
        if d := os.environ.get('AMC_TESTS_DIR'):
            date = datetime.datetime.now().strftime("%s")
            test = os.path.basename(sys.argv[0])
            self.temp_dir = f"{d}/{date}-{test}"
            Path(self.temp_dir).mkdir(parents=True, exist_ok=True)
        else:
            self.temp_dir = tempfile.mkdtemp(prefix="amcweb-test-")
        self.log(f"TEMPDIR: {self.temp_dir}")

    def set_user(self, user_name):
        assert self.user_header is not None
        self.log(f"* set user {user_name}")
        self.driver.execute_cdp_cmd(
            'Network.setExtraHTTPHeaders',
            { "headers": { self.user_header: user_name } }
        )
        self.user_name = user_name
        self.goto_home()

    def sleep(self, t):
        dt = t * self.sleep_factor
        if self.random_delay:
            dt = dt * (1 + 0.25 * random.random())
        time.sleep(dt)

    def launch(self):
        chrome_options = Options()
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        if os.environ.get('AMC_TESTS_HEADLESS'):
            chrome_options.add_argument("--headless=new")
        if os.environ.get('AMC_TESTS_NO_SANDBOX'):
            chrome_options.add_argument("--no-sandbox")

        # Allow all downloads from server:
        chrome_options.add_argument(
            f"--unsafely-treat-insecure-origin-as-secure={self.base_url}")
        prefs = {
            "download.default_directory": self.temp_dir,
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
            "safebrowsing.enabled": True
        }
        
        if self.lang:
            chrome_options.add_argument(f"--lang={self.lang}")
            prefs["intl.accept_languages"] = self.lang

        chrome_options.add_experimental_option("prefs", prefs)

        svc = selenium.webdriver.ChromeService(
            executable_path="/usr/bin/chromedriver")
        self.driver = selenium.webdriver.Chrome(
            options=chrome_options,
            service=svc)

        self.sleep(1)
        self.driver.set_window_size(1400, 800)
        self.sleep(1)

        if self.user_header:
            self.driver.execute_cdp_cmd('Network.enable', {})

        self.tab = "main"

        return self

    def quit(self):
        self.driver.quit()
        self.sleep(1)

    def session_id(self):
        return self.driver.get_cookie("amcsession")["value"]

    def click_on(self, element_id, by=By.ID):
        self.wait_for_visible(element_id, by=by)
        self.driver.find_element(by, element_id).click()

    def projects_list_element(self, user=""):
        x = f'//ul[@amc-user="{user}"]'
        self.wait_for_visible(x, by=By.XPATH)
        return self.driver.find_elements(By.XPATH, x)

    def projects_elements(self, user=""):
        projects = []
        for ple in self.projects_list_element(user=user):
            projects += ple.find_elements(By.CSS_SELECTOR, "li")
        return projects

    def projects_list(self, user=""):
        self.goto_tab("main")
        return [ p.text for p in
                 self.projects_elements(user=user) ]

    def delete_project_if_exists(self, project_name, user=""):
        self.goto_tab("main")
        olds = self.projects_elements(user=user)
        old = [ p for p in olds if p.text == project_name ]
        if old:
            self.log(f"Delete project {project_name}…")
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
        if self.fake_user:
            self.switch_user(self.fake_user, self.project_name)
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

    def wait_for_name(self, kind, name):
        eid = f"{kind}-name"
        if name == True:
            self.wait_for_different(eid, "")
        else:
            self.wait_for_equal(eid, name)

    def wait_for_different(self, element, text, by=By.ID):
        wait = WebDriverWait(self.driver,
                             timeout=10*self.sleep_factor,
                             poll_frequency=.2,
                             ignored_exceptions=[NoSuchElementException])
        wait.until(lambda _ :
                   self.driver.find_element(by, element).text != text)

    def wait_for_equal(self, element, text, by=By.ID):
        wait = WebDriverWait(self.driver,
                             timeout=10*self.sleep_factor,
                             poll_frequency=.2,
                             ignored_exceptions=[NoSuchElementException])
        wait.until(lambda _ :
                   self.driver.find_element(by, element).text == text)

    def element_is_hidden(self, element, by=By.ID):
        e = self.driver.find_element(by, element)
        cl = e.get_attribute('class').split()
        return "hidden" in cl

    def wait_for_visible(self, element, total=10, by=By.ID):
        wait = WebDriverWait(self.driver,
                             timeout=total*self.sleep_factor,
                             poll_frequency=.2,
                             ignored_exceptions=[NoSuchElementException])
        wait.until(lambda _ :
                   not self.element_is_hidden(element, by=by))

    def wait_for_hidden(self, element, total=10, by=By.ID):
        wait = WebDriverWait(self.driver,
                             timeout=total*self.sleep_factor,
                             poll_frequency=.2,
                             ignored_exceptions=[NoSuchElementException])
        wait.until(lambda _ :
                   self.element_is_hidden(element, by=by))

    def wait_for_endcommand(self, start_delay=.5, total=10, end_delay=.5):
        self.sleep(start_delay)
        self.wait_for_hidden("info-panel", total=total)
        self.sleep(end_delay)

    def wait_for_downloaded(self, filename, end_delay=.5):
        path = self.temp_dir + "/" + filename
        wait = WebDriverWait(self.driver,
                             timeout=10*self.sleep_factor,
                             poll_frequency=.2)
        wait.until(lambda _ : os.path.isfile(path))
        self.sleep(end_delay)

    def new_project_from_template(self, project_name, template,
                                  group=True, test_emptyname=False):
        self.log(f"Create project {project_name} from template {template}…")
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
            By.ID, "do-create-project")

        if test_emptyname:
            create.click()
            self.wait_for_alert(check_message='choose a name')

        self.driver.find_element(By.ID,'new-project-name').send_keys(project_name)
        create.click()

        self.wait_for_name("project", project_name)
        self.sleep(1)

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
        self.sleep(.5)
        self.driver.find_element(By.ID, 'project-upload-file').send_keys(os.path.abspath(path))
        self.sleep(.5)
        self.driver.find_element(By.ID, "source-name").click()
        self.sleep(1)

    def new_project_from_source_content(self, project_name, format="plain", content=""):
        self.log(f"Create project {project_name} ({format})…")
        self.driver.find_element(By.ID,'new-project-name').send_keys(project_name)
        self.driver.find_element(By.ID, 'way-empty').click()
        sel = Select(self.driver.find_element(By.ID, 'source-type'))
        sel.select_by_value(format)
        self.sleep(.5)
        self.driver.find_element(
            By.ID, "do-create-project").click()

        self.wait_for_name("project", project_name)
        self.sleep(.5)

        self.project_name = project_name
        self.tab = "source"

        self.set_source_content(content)
        self.sleep(.5)

    def new_project_from_file(self, project_name, archive_path):
        self.log(f"Create project {project_name} from {archive_path}…")
        self.driver.find_element(By.ID,'new-project-name').send_keys(project_name)
        self.driver.find_element(By.ID, 'way-file').click()
        self.driver.find_element(By.ID, 'source-file').send_keys(os.path.abspath(archive_path))
        self.driver.find_element(
            By.ID, "do-create-project").click()

        self.wait_for_name("project", project_name)
        self.sleep(1)

        self.project_name = project_name
        self.tab = "source"
        
    def goto_tab(self, tab_name, force=False):
        if self.tab == tab_name and not force:
            self.log(f"Already on tab {tab_name}")
        else:
            self.log(f"Go to tab {tab_name}…")
            self.driver.find_element(By.ID, 'menu-' + tab_name).click()
            self.tab = tab_name

            match tab_name:
                case "source":
                    self.wait_for_name("source", True)
                case "scans":
                    self.wait_for_visible("scans-pages")
            
            self.sleep(1)

    def document_view(self, doc_type, build=False):
        self.log(f"Looking at document {doc_type}…")
        self.goto_tab("source")
        sel = Select(self.driver.find_element(By.ID, 'doc-type'))
        sel.select_by_value(doc_type)
        if doc_type == "layout":
            self.wait_for_different("layout-page", "")
        else:
            self.sleep(2)
        if build:
            self.driver.find_element(By.ID, 'doc-update').click()
            self.wait_for_endcommand()
            self.sleep(2)
        
    def layout_page(self, action):
        start_page = self.driver.find_element(By.ID, 'layout-page').text
        self.click_on('layout-page-' + action)
        self.wait_for_different("layout-page", start_page)
        self.sleep(.5)

    def print_menu(self):
        self.log("Open print menu…")
        self.document_view("sujet")
        self.click_on('doc-print-btn')
        self.sleep(.5)
    
    def check_downloaded(self, filename):
        path = self.temp_dir + "/" + filename
        assert os.path.isfile(path), f"Missing downloaded file {path}…"
        return path

    def print_to_files(self, first_page=1, last_page=None):
        self.log("Print to files…")
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
        self.wait_for_endcommand()
        path = self.check_downloaded("printed.zip")
        self.goto_home()
        return path
        
    def get_fs_file(self, path, local_filename=None):
        self.log(f"Download {path}…")
        if local_filename is None:
            local_filename = path
        url = f"{self.base_url}/fs/{self.project_name}/{path}"
        headers = {}
        if self.user_name:
            headers[self.user_header] = self.user_name
            if self.fake_user:
                url += f"?user={self.fake_user}"
        r = requests.get(url,
                         headers=headers,
                         cookies={
                             "amcsession": self.session_id()
                         })
        assert r.status_code == 200
        local_path = self.temp_dir + "/" + local_filename
        with open(local_path, "wb") as f:
            f.write(r.content)
        self.log(f"-> {local_path}")
        return local_path

    def upload_scans(self, *paths, **kwargs):
        self.goto_tab("scans")

        if kwargs.get('photocopy') is not None:
            self.set_input({'scans-photocopied': kwargs.get('photocopy')})
        if kwargs.get('multimode') is not None:
            self.set_input({'multi_scan_mode': kwargs.get('multimode')})
            
        self.log("Uploading scans…")
        txt = "\n".join([ os.path.abspath(p) for p in paths ])
        self.driver.find_element(By.ID, 'scans-upload').send_keys(txt)
        self.wait_for_endcommand( total=max(10, 2 * len(paths)) )
        self.sleep(1)

    def upload_list(self, path):
        self.log("Uploading students list…")
        self.goto_tab("grading")
        self.driver.find_element(By.ID, 'students-upload').send_keys(os.path.abspath(path))
        self.wait_for_endcommand()

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

    def check_scanned_pages(self, pages_to_check, pages_must_be_missing=[]):
        self.log(f"Checking for scanned pages {pages_to_check}…")
        pages = self.scanned_pages_list()
        for p in pages:
            self.log(f"Page: {p}")
            pid = (int(p.get("student",0)),
                   int(p.get("page"),0),
                   int(p.get("copy"),0))
            pages_to_check.remove(pid)
            if pid in pages_must_be_missing:
                raise RuntimeError(f"Scanned page present: {pid}")
            
        if pages_to_check:
            raise RuntimeError(f"Scanned pages not found: {pages_to_check}")

    def read_dialog(self, ok=True, **check):
        w = self.driver.find_element(By.ID, 'warn-panel')
        for k in ('err', 'warn', 'dialog'):
            if check.get(k):
                txt = w.find_element(By.ID, f"warn-{k}-text")
                assert check[k] in txt.text
                self.log(f"Dialog [{k}]: {check[k]}")
        if ok:
            w.find_element(By.CLASS_NAME, "btn").click()

    def do_grading(self):
        self.log("Grading…")
        self.goto_tab("grading")
        self.click_on("do-mark")
        self.wait_for_endcommand()

    def do_association_auto(self):
        self.click_on('do-association-auto')
        self.wait_for_endcommand()
        self.read_dialog()

    def do_association_manual(self, assoc):
        self.goto_tab("grading")
        self.driver.find_element(By.ID, 'do-association-manual').click()
        self.sleep(.5)
        sheets = self.driver.find_element(By.ID, 'assoc-sheets')
        slist = self.driver.find_element(By.ID, 'students-list')
        for student in assoc:
            self.log(f'Click on student {student["student"]}')
            tr = sheets.find_element(By.XPATH, f'//tr[@amc-student="{student["student"]}"]')
            tr.click()
            self.sleep(1.5)
            if student.get("name"):
                text = sheets.find_element(By.XPATH, '//div[@class="sheetnum"]/div').text
                self.log(f"Found {text}")
                if text != student["name"]:
                    raise RuntimeError(f'Can\'t see name {student["name"]} (instead: {text})')
            slist.find_element(By.XPATH, f'//li[@amc-id="{student["id"]}"]').click()
            self.sleep(.5)
        self.driver.find_element(By.ID, 'assoc-manual-done').click()
        self.sleep(.5)

    def do_export(self, **options):
        self.log("Export marks…")
        self.goto_tab("grading")

        sel = Select(self.driver.find_element(By.ID, 'format_export'))
        sel.select_by_value(options.get('format', 'CSV'))

        sel = Select(self.driver.find_element(By.ID, 'export_csv_ticked'))
        sel.select_by_value(options.get('csv_ticked', 'AB'))

        self.click_on("do-export")
        self.wait_for_endcommand(end_delay=1)

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
                        self.log(f"Right mark: for student {student}: {k} = {v}")
                    else:
                        errors.append(
                            f"{v}\nWrong mark for student {student}: {k} = {computed} but should be {expected}")
                del(marks[student])
        for k,v in marks.items():
            errors.append(f"Missing grades for {k}, should be {v}")
        if errors:
            self.log(f"Wrong marks from {filename}:")
            for e in errors:
                self.log(e)
            raise RuntimeError("Wrong marks")

    def do_annotate(self, **options):
        self.log("Annotating…")
        self.goto_tab("grading")

        sel = Select(self.driver.find_element(By.ID, 'regroupement_type'))
        sel.select_by_value(options.get('type', 'STUDENTS'))

        model = self.driver.find_element(By.ID, 'modele_regroupement')
        model.clear()
        model.send_keys(options.get('model', ''))

        self.click_on("do-annotate")
        self.wait_for_endcommand()

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
        self.log(f"Annotated files: {list(annotated_files.keys())}")

        for filename in files:
            annotated_files[filename].click()
            self.wait_for_downloaded(filename)

        self.reload()

    def set_input(self, options):
        for k,v in options.items():
            element = self.driver.find_element(By.ID, k)
            self.log(f"Set {k}={v}")
            if v==True:
                if not element.is_selected():
                    element.click()
            elif v==False:
                if element.is_selected():
                    element.click()
            else:
                if element.tag_name == 'select':
                    sel = Select(element)
                    sel.select_by_value(v)
                else:
                    element.clear()
                    element.send_keys(str(v) + "\t")
        self.sleep(1)

    def get_input(self, option):
        element = self.driver.find_element(By.ID, option)
        if element.get_attribute("type") == 'checkbox':
            return element.is_selected()
        else:
            return element.get_attribute("value")

    def check_options(self, options):
        self.goto_tab("config")
        for k,v in options.items():
            assert self.get_input(k) == v

    def set_options(self, options):
        self.goto_tab("config")
        self.set_input(options)

    def check_text(self, eid, text):
        e = self.driver.find_element(By.ID, eid)
        assert e.text == text
        self.log(f"Text[{eid}]={text}")

    def public_marks(self, activate=True):
        self.goto_tab("grading")
        self.set_input({"app_public_marks": activate})
        if activate:
            links = []
            for k in ('marks', 'totals'):
                s = self.driver.find_element(
                    By.ID, "public-marks-link-" + k)
                links.append(s.get_attribute("public-link"))
            return links

    def check_from_public(self, marks, and_disable=True):
        marks_link, totals_link = self.public_marks(True)
        url, column = marks_link.split("#")
        column = int(column)
        r = requests.get(url)
        assert r.status_code == 200
        reader = csv.reader(io.StringIO(r.content.decode("utf-8")),
                            delimiter=',', quotechar='"')
        for row in reader:
            student_id = row[0]
            student_mark = row[column-1]
            try:
                student_mark = float(student_mark)
            except ValueError:
                student_mark = None
            if marks.get(student_id):
                if marks[student_id] == student_mark:
                    self.log(f"Public mark OK for student {student_id}: {student_mark}")
                    del marks[student_id]
                else:
                    raise RuntimeError(
                        f"Wrong mark for student {student_id}: expected {marks[student_id]}, got {student_mark}")
        if marks:
            for k in marks.keys():
                self.log(f"Missing public mark for student {k}")
            raise RuntimeError("Public marks not complete")

        if and_disable:
            self.log("Test disabling public marks…")
            self.public_marks(False)
            r = requests.get(url)
            assert r.status_code == 404

    def check_admin_search(self, status=True):
        disp = self.driver.find_element(
            By.ID, "menu-admin-search").is_displayed()
        self.log(f"admin-search displayed: {disp}")
        assert disp == status

    def open_project(self, project_name):
        self.log(f"Open project {project_name}")
        self.goto_tab("main")
        self.click_on(f'//li[text()="{project_name}"]', by=By.XPATH)
        self.wait_for_name("source", True)
        self.sleep(1)

    def switch_user(self, user, project=None):
        self.log(f"fake user {user}")
        self.goto_tab("main")
        self.driver.find_element(
            By.ID, "menu-admin-search").click()
        if project:
            x = f'//ul[@amc-user="{user}"]/li[text()="{project}"]'
        else:
            x = f'//span[@amc-user="{user}"]'
        self.click_on(x, by=By.XPATH)
        self.fake_user = user
        self.wait_for_visible("menu-admin-back")
        if project:
            self.wait_for_name("source", True)
        else:
            self.sleep(1)
        back = self.driver.find_element(By.ID, "menu-admin-back")
        assert back.get_attribute("title") == user
        self.sleep(1)

    def admin_back(self):
        self.driver.find_element(By.ID, "menu-admin-back").click()
        self.sleep(1)
