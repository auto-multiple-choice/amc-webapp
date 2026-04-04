
messages: FORCE
	$(foreach lang,en fr,$(MAKE) server/translations/$(lang)/LC_MESSAGES/messages.mo ; )

messages.pot: server/*.py server/templates/*.html
	pybabel extract -F babel.cfg -o messages.pot .
	pybabel update -i messages.pot -d server/translations

server/translations/%/LC_MESSAGES/messages.mo: server/translations/%/LC_MESSAGES/messages.po
	pybabel compile -l $* -d server/translations

FORCE: ;
