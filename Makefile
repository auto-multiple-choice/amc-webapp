
build: messages ace

clean: FORCE
	-rm -f server/translations/*/LC_MESSAGES/messages.mo
	$(MAKE) -C server/ace-src clean

messages: FORCE
	$(foreach lang,en fr,$(MAKE) server/translations/$(lang)/LC_MESSAGES/messages.mo ; )

ace: server/static/ace/mode-amc_txt.js ;

server/static/ace/mode-amc_txt.js: server/ace-src/mode-amc_txt.js
	cp $< $@

server/ace-src/mode-amc_txt.js: FORCE
	$(MAKE) -C server/ace-src

messages.pot: server/*.py server/templates/*.html
	pybabel extract -F babel.cfg -o messages.pot .
	pybabel update -i messages.pot -d server/translations

server/translations/%/LC_MESSAGES/messages.mo: server/translations/%/LC_MESSAGES/messages.po
	pybabel compile -l $* -d server/translations

FORCE: ;
