
build: messages ace icons

clean: FORCE
	-rm -f server/translations/*/LC_MESSAGES/messages.mo
	-rm -f server/static/icons.css
	$(MAKE) -C server/ace-src clean

messages: FORCE
	$(foreach lang,en fr,$(MAKE) server/translations/$(lang)/LC_MESSAGES/messages.mo ; )

ace: server/ace/mode-amc_txt.js ;

server/ace/mode-amc_txt.js: server/ace-src/mode-amc_txt.js
	cp $< $@

server/ace-src/mode-amc_txt.js: FORCE
	$(MAKE) -C server/ace-src

icons: server/static/icons.css ;

server/static/icons.css: src-icons/iconoir.css src-icons/select-icons.py server/templates/*.html
	python3 src-icons/select-icons.py > $@

messages.pot: server/*.py server/templates/*.html server/static/amc.js
	pybabel extract -F babel.cfg -k alert_msg -k confirm_msg -o messages.pot .
	pybabel update -i messages.pot -d server/translations

server/translations/%/LC_MESSAGES/messages.mo: server/translations/%/LC_MESSAGES/messages.po
	pybabel compile -l $* -d server/translations

version: FORCE
	-echo 'APP_VERSION="'`git describe --tags`'"' > server/version.py

FORCE: ;
