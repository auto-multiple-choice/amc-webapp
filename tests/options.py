
from amcweb import AMCWeb

import os
import sys
from multiprocessing import Process, set_start_method
import time
import random
import filecmp

from selenium.webdriver.common.by import By

n_users = min(10, int(os.environ.get("AMC_TESTS_PROCESSES", 200)))
n_trials = 100

project_name = "test-options"
sleep_f0 = float(os.environ.get('AMC_TESTS_SLEEP_FACTOR', 1))

def one_user(u):
    aw = AMCWeb(prefix=f"{u}> ")
    aw.sleep(u)
    aw.launch()
    aw.goto_home()
    aw.open_project(project_name)
    aw.goto_tab("config")
    aw.sleep(15-u)

    aw.sleep_factor = 0
    
    for _ in range(n_trials):
        time.sleep(.2)
        t3 = aw.driver.find_element(By.ID, "global:try_three")
        ng = aw.driver.find_element(By.ID, "note_grain")
        t3.click()
        ng.clear()
        ng.send_keys(str(int(5 * random.random())))
        if random.random() < 0.1:
            aw.sleep_factor = 0.5 * sleep_f0
            aw.goto_home()
            aw.sleep_factor = sleep_f0
            aw.open_project(project_name)
            aw.goto_tab("config")
            aw.sleep_factor = 0

aw = AMCWeb(prefix=f"*> ")
aw.launch()
aw.goto_home()
aw.delete_project_if_exists(project_name)
aw.new_project_from_template(project_name, "fr:simple-txt")

special = {
      'verdict': 'Beau travail.',
      'global:bw_threshold': '0.25', 
}

aw.set_options(
    { 'global:try_three': True,
      'note_grain': 0.1,
     })
aw.set_options(special)

o = aw.get_fs_file('options.xml')
os.rename(o, o+".1")

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

aw.goto_home()
aw.set_options(
    { 'global:try_three': True,
      'note_grain': 0.1 })

o = aw.get_fs_file('options.xml')
os.rename(o, o+".2")
print(o)

aw.check_options(special)

assert filecmp.cmp(o+".1",o+".2")

