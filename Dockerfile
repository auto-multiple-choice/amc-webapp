FROM alpine

ARG AMC_REVISION=7121d8be9d847928e49192eb19c331dab0f267cb
ARG TEXLIVE_PKGS

###############################################################
# TeXLive

RUN apk add texlive texlive-luatex texlive-xetex texlive-latexextra texmf-dist-langfrench
RUN if [ "$TEXLIVE_PKGS" ]; then apk add $TEXLIVE_PKGS ; fi

###############################################################
# AMC

RUN apk add git

WORKDIR /tmp
RUN git clone https://gitlab.com/auto-multiple-choice/auto-multiple-choice.git --revision=$AMC_REVISION
WORKDIR /tmp/auto-multiple-choice

# Replace font Rasheeq with Noto for arabic templates, if available
RUN apk list font-noto-naskh-arabic | grep installed || true && \
    perl -pi -e 's/Rasheeq/Noto Naskh Arabic/' models/ar/*.d/*.tex

# Delete arabic models if LaTeX support for Arabic is not installed
RUN apk list texmf-dist-langarabic | grep installed || rm -rf models/ar

# Delete Japanese models if LaTeX support for Japanese is not installed
RUN apk list texmf-dist-langjapanese | grep installed || rm -rf models/ja

# Build dependencies for AMC

RUN apk add make g++ pkgconf rsvg-convert netpbm-dev opencv-dev cairo-dev pango-dev poppler-dev libgcc curl

RUN make version_files
RUN make PERLDIR=/usr/share/perl5/vendor_perl TEXDIR=/usr/share/texmf-dist/tex/latex/AMC TAR_REPRODUCIBLE_ARGS=nonreproducible
RUN make install PERLDIR=/usr/share/perl5/vendor_perl TEXDIR=/usr/share/texmf-dist/tex/latex/AMC

WORKDIR /tmp
RUN rm -rf auto-multiple-choice

RUN texhash

# Perl and fonts dependencies for AMC

RUN apk add perl-locale-gettext perl-xml-simple perl-xml-writer imagemagick imagemagick-perlmagick perl-dbi perl-dbd-sqlite perl-file-mimeinfo perl-text-csv perl-glib perl-archive-zip perl-clone perl-locale-codes perl-yaml-syck perl-hash-merge perl-sys-cpu perl-xml-twig perl-text-unidecode

# Build and install perl-net-cups

RUN apk add perl-dev cups-dev cups-filters-dev

RUN curl https://cpan.metacpan.org/authors/id/N/NI/NINE/Net-CUPS-0.64.tar.gz -o NC.tgz
RUN tar xf NC.tgz
RUN cd Net-CUPS-0.64 && perl Makefile.PL && make && make install
RUN rm -rf NC.tgz Net-CUPS-0.64

# Build and install perl-openoffice-oodoc

RUN curl https://cpan.metacpan.org/authors/id/J/JM/JMGDOC/OpenOffice-OODoc-2.125.tar.gz -o OO.tgz
RUN tar xf OO.tgz
RUN cd OpenOffice-OODoc-2.125 && perl Makefile.PL && make && make install
RUN rm -rf OO.tgz OpenOffice-OODoc-2.125

# Build ans install perl-graphics-colornames

RUN curl https://cpan.metacpan.org/authors/id/R/RR/RRWO/Graphics-ColorNames-v3.5.0.tar.gz -o CN.tgz
RUN tar xf CN.tgz
RUN cd Graphics-ColorNames-v3.5.0 && perl Makefile.PL && make && make install
RUN rm -rf CN.tgz Graphics-ColorNames-v3.5.0

# Other dependencies for AMC

RUN apk add netpbm ghostscript poppler-utils unzip font-linux-libertine qpdf

###############################################################
# AMC-web

RUN apk add py3-pip python3-dev uglify-js go

COPY requirements.txt .
RUN python3 -m venv /venv
RUN /venv/bin/pip3 install -r requirements.txt
RUN /venv/bin/pip3 install gunicorn

WORKDIR /tmp
RUN git clone https://github.com/zouuup/landrun.git
WORKDIR /tmp/landrun
RUN go build -o landrun cmd/landrun/main.go
RUN cp landrun /usr/local/bin/

RUN mkdir -p /amc-web/files
RUN chown -R 1000:1000 /amc-web

# The new interface's template gallery: each template compiled once
# (server/ui_gallery.py). A layer of its own, redone only when the
# templates or the script change.
COPY --chown=1000:1000 server/ui_gallery.py /amc-web/gallery-build/ui_gallery.py
COPY --chown=1000:1000 server/school_templates /amc-web/gallery-build/school_templates
RUN HOME=/tmp/gallery-home AMC_TXT_DEFAULTFONT="Linux Libertine" \
    python3 /amc-web/gallery-build/ui_gallery.py /usr/share/auto-multiple-choice/models \
      /amc-web/gallery-build/school_templates /amc-web/gallery \
 && chown -R 1000:1000 /amc-web/gallery && rm -rf /tmp/gallery-home /amc-web/gallery-build

COPY --chown=1000:1000 server /amc-web/server
COPY --chown=1000:1000 src-icons /amc-web/src-icons
COPY --chown=1000:1000 Makefile /amc-web

USER 1000

WORKDIR /amc-web
RUN touch /amc-web/files/.keep

ENV HOME=/amc-web/files
ENV PATH=/venv/bin:${PATH}
ENV AMC_TXT_DEFAULTFONT="Linux Libertine"
ENV AMC_TXT_DEFAULTFONT_ARABIC="Noto Naskh Arabic"
ENV AMC_ISOLATE_ROX=/usr,/bin,/lib,/venv/bin
RUN make

VOLUME /amc-web/files

EXPOSE 8080
WORKDIR /amc-web/server
ENV FLASK_APP=amc
RUN flask digest compile

CMD [ "gunicorn", "-k", "gevent", "-w", "1", "amc:app", "-b", "0.0.0.0:8080", "--preload", "--access-logfile",  "-" ]
