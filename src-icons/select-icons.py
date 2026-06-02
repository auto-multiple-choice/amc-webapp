
import os
import re

src_file = 'src-icons/iconoir.css'
templates_dir = 'server/templates'
stroke_width = '2'

icons = set()

icon_re = re.compile(r'<i class="iconoir-([0-9a-z-]+)')

for f in os.listdir(templates_dir):
    ff = os.path.join(templates_dir, f)
    with open(ff) as file:
        for line in file:
            for i in icon_re.findall(line):
                icons.add(i)

css_re = re.compile(r'.iconoir-([0-9a-z-]+)::before{.*?}')
width_re = re.compile(r'stroke-width="[0-9.]+"')

with open(src_file) as file:
    for line in file:
        to_rm = []
        for i in css_re.finditer(line):
            if i[1] not in icons:
                to_rm.append(i[0])
        for x in to_rm:
            line = line.replace(x, "")
        line = width_re.sub(f'stroke-width="{stroke_width}"', line)
        print(line, end="")

