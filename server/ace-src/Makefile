
all: mode-amc_txt.js

clean: FORCE;
	-rm -f *.0 mode-amc_txt.js

amc_txt_rules.js.0: amc_txt_rules.js Makefile 
	uglifyjs $< -c -m | sed 's:^define(:ace.define("ace/mode/amc_txt_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"],:' | perl -pe 's:;[\n\r]*$$::' > $@

amc_txt.js.0: amc_txt.js Makefile
	uglifyjs $< -c -m | sed 's:^define(:ace.define("ace/mode/amc_txt",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/amc_txt_highlight_rules"],:' | perl -pe 's:;[\n\r]*$$::' > $@

mode-amc_txt.js: amc_txt_rules.js.0 amc_txt.js.0 foot.js
	cat amc_txt_rules.js.0 > $@
	echo -n "," >> $@
	cat amc_txt.js.0 >> $@
	echo -n ";" >> $@
	cat foot.js >> $@

FORCE: ;
