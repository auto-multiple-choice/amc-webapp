
"""This test check that the AMC commands calls won't block the server:
it launches 10 clients that requests at the same time a 20 seconds sleep
as an AMC command, and checks that the overall clock time for theses
commands does not exceed 20 seconds by far.
""" 

from amcweb import AMCWeb

import os
from multiprocessing import Pool, set_start_method
import time

n_users = int(os.environ.get("AMC_TESTS_PROCESSES", 10))
sleep_time = int(os.environ.get("AMC_TESTS_SLEEP_TIME", 20))

def one_user(u):

    aw = AMCWeb(
        user_header=os.environ.get("AMC_USERHEADER", "Test-User"),
        random_delay=False, prefix=f"{u}> ",
    )
    aw.extend_sleep_factor(5)
    
    aw.sleep(u)
    aw.launch()
    aw.set_user(f"jojo{u}", to_home=False)
    aw.sleep(n_users - u)

    aw.start_sleep(sleep_time)
    aw.wait_for_warning(total=sleep_time/aw.sleep_factor + 5)

    return aw.total_sleeps + sleep_time

set_start_method('fork')

start_time = time.time()
print(f"Start: {start_time}")

pool = Pool(processes = n_users)
dts = pool.map(one_user, range(n_users))
dtmax = max(dts)

end_time = time.time()
print(f"End: {end_time}")

working = end_time - start_time - dtmax

print(f"Sleeps: {dts}")
print(f"Working: {working}")

assert 0 < working < 5 
