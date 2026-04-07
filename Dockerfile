FROM alpine

ARG AMC_REVISION=c84222b439cc1816e73aa2381199cec8eacff852

###############################################################
# TeXLive

RUN apk add texlive texlive-luatex texlive-xetex texlive-latexextra texmf-dist-langfrench

###############################################################
# AMC

RUN apk add git

WORKDIR /tmp
RUN git clone https://gitlab.com/a10684/auto-multiple-choice.git --revision=$AMC_REVISION
WORKDIR /tmp/auto-multiple-choice

# Build dependencies for AMC

RUN apk add make g++ pkgconf rsvg-convert netpbm-dev opencv-dev cairo-dev pango-dev poppler-dev libgcc curl

RUN make version_files
RUN make PERLDIR=/usr/share/perl5/vendor_perl TEXDIR=/usr/share/texmf-dist/tex/latex/AMC TAR_REPRODUCIBLE_ARGS=nonreproducible
RUN make install PERLDIR=/usr/share/perl5/vendor_perl TEXDIR=/usr/share/texmf-dist/tex/latex/AMC

WORKDIR /tmp
RUN rm -rf auto-multiple-choice

RUN texhash

# Perl dependencies for AMC

RUN apk add perl-locale-gettext perl-xml-simple perl-xml-writer imagemagick imagemagick-perlmagick perl-dbi perl-dbd-sqlite perl-file-mimeinfo perl-text-csv perl-glib perl-archive-zip perl-clone perl-locale-codes perl-yaml-syck perl-hash-merge perl-sys-cpu perl-xml-twig perl-gtk3

# Build and install perl-net-cups

RUN apk add perl-dev cups-dev cups-filters-dev

RUN curl https://cpan.metacpan.org/authors/id/N/NI/NINE/Net-CUPS-0.64.tar.gz -o NC.tgz
RUN tar xf NC.tgz
RUN cd Net-CUPS-0.64 && perl Makefile.PL && make && make install
RUN rm -rf Net-CUPS-0.64

# Build and install perl-openoffice-oodoc

RUN curl https://cpan.metacpan.org/authors/id/J/JM/JMGDOC/OpenOffice-OODoc-2.125.tar.gz -o OO.tgz
RUN tar xf OO.tgz
RUN cd OpenOffice-OODoc-2.125 && perl Makefile.PL && make && make install
RUN rm -rf OpenOffice-OODoc-2.125

# Other dependencies for AMC

RUN apk add netpbm ghostscript poppler-utils unzip font-linux-libertine qpdf

###############################################################
# AMC-web

RUN apk add py3-pip python3-dev

COPY requirements.txt .
RUN python3 -m venv /venv
RUN /venv/bin/pip3 install -r requirements.txt
RUN /venv/bin/pip3 install gunicorn

RUN mkdir -p /amc-web
RUN chown 1000:1000 /amc-web

COPY --chown=1000:1000 server /amc-web/server
COPY --chown=1000:1000 Makefile /amc-web

USER 1000

WORKDIR /amc-web

RUN mkdir files
ENV HOME=/amc-web/files
ENV PATH=/venv/bin:${PATH}
ENV AMC_TXT_DEFAULTFONT="Linux Libertine"
RUN make messages

VOLUME /amc-web/files

EXPOSE 8080
WORKDIR /amc-web/server
CMD [ "gunicorn", "-k", "gevent", "-w", "1", "amc:app", "-b", "0.0.0.0:8080", "--preload" ]
