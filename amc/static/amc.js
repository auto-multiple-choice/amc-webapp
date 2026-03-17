var socket = io();

var project_name = null;

function show_tab(tab_name) {
    return fetch('/static/tab_' + tab_name + '.html')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(html => {
            document.getElementById('tab').innerHTML = html;
        })
        .catch(error => {
            console.error('There has been a problem with your fetch operation:', error);
        });
}

socket.on("projects-list", function(html) {
    var list = document.getElementById('projects-list');
    if(list) {
        list.innerHTML = html;
    }
});

function tab_main() {
    show_tab("main").then(() => {
        socket.emit("projects-list");
    });
}

tab_main();

function source_url() {
    var cn = document.getElementById('source-name');
    if(cn) {
        return("/" + socket.id + "/fs/" + project_name + "/" + cn.textContent);
    } else {
        return(null);
    }
}

socket.on("source-name", function(name) {
    var cn = document.getElementById('source-name');
    if(cn) {
        cn.textContent = name;
    } else {
        alert("source-name not found");
    }
    var dl = document.getElementById('source-download');
    if(dl) {
        dl.setAttribute("href", source_url());
    }
});

socket.on("ncopies", function(n) {
    nc = document.getElementById('ncopies');
    if(nc) {
        nc.value = n;
    }
});

var editor = null;

function source_modified(t) {
    for(const i of ["source-save", "source-revert"]) {
        var b = document.getElementById(i);
        if(b) {
            if(t) b.classList.remove("disabled");
            else b.classList.add("disabled");
        }
    }
}

socket.on("source-code", function(code) {
    var cc = document.getElementById('code-code');
    if(cc) {
        if(!editor) {
            editor = ace.edit("code-code");
            editor.setTheme("ace/theme/textmate");
            editor.session.on('change', function(delta) {
                source_modified(true);
            });
        }
        editor.session.setMode("ace/mode/latex");
        editor.session.setValue(code, -1);
        source_modified(false);
        fl = document.getElementById("files-list");
        if(fl) {
            fl.classList.add("hidden");
        }
    }
});

socket.on("source-saved", function() {
    source_modified(false);
});

socket.on("files-list", function(html) {
    var list = document.getElementById('files-list');
    if(list) {
        list.innerHTML = html;
    }
});

function select_file(f) {
    var cn = document.getElementById('source-name');
    if(cn) {
        cn.textContent = f;
        source_revert();
    }
}

function source_other() {
    fl = document.getElementById("files-list");
    if(fl.classList.contains("hidden")) {
        fl.classList.remove("hidden");
        socket.emit("files-list");
    } else {
        fl.classList.add("hidden");
    }
}

function source_revert() {
    var cn = document.getElementById('source-name');
    if(cn) {
        socket.emit("source-code", cn.textContent);
    }
}

function source_save() {
    var cn = document.getElementById('source-name');
    if(cn && editor) {
        socket.emit("source-save", cn.textContent, editor.getValue());
    }
}

async function source_upload() {
  const formData = new FormData();

  const selection = await window.showOpenFilePicker();
  if (selection.length > 0) {
      const file = await selection[0].getFile();
      formData.append("file", file);
  }
    
    try {
        const response = await fetch(source_url(), {
            method: "POST",
            body: formData,
        });
        source_revert();
        console.log(await response.json());
    } catch (e) {
        console.error(e);
    }
}

function tab_source() {
    editor = null;
    show_tab("source").then(() => {
        socket.emit("project-name", project_name);
        socket.emit("source-code", "");
    });
}

function select_project(name) {
    project_name = name;
    document.getElementById('project-name').innerHTML = name;
    tab_source();
}

socket.on("connect", () => {
    socket.emit("project-name", project_name);
});

function change_ncopies() {
    socket.emit("ncopies",
                document.getElementById('ncopies').value);
}

socket.on("document-content", function(html) {
    var du = document.getElementById('doc-update');
    if(du) {
        if(document.getElementById('doc-type').value)
            du.classList.remove('disabled');
        else du.classList.add('disabled');
    }
    var view = document.getElementById('document-view');
    if(view) {
        view.innerHTML = html;
    }
});

function change_doc_type() {
    t = document.getElementById('doc-type').value;
    upd = document.getElementById('doc-update');
    if(t == "calage") upd.classList.add("hidden");
    else upd.classList.remove("hidden");
    socket.emit("doc-type", t);
}

function doc_update() {
    socket.emit("doc-update",
                document.getElementById('doc-type').value);
}

function set_t(text) {
    var panel = document.getElementById('info-text');
    panel.textContent = text;
}

function set_p(prop) {
    var pc = 100.0*prop;
    var prog = document.getElementById('info-prop');
    prog.value = pc;
    prog.textContent = pc.toFixed(1) + " %";
}

socket.on("t", set_t);

socket.on("p", set_p);

socket.on("begin-command", function() {
    set_t("");
    set_p(0);
    var panel = document.getElementById('info-panel');
    panel.classList.remove('hidden');
});

socket.on("end-command", function() {
    var panel = document.getElementById('info-panel');
    panel.classList.add('hidden');
});

socket.on("err", function(html) {
    var w = document.getElementById('warn-err-text');
    w.innerHTML = html;

    w = document.getElementById('warn-err');
    if(html) w.classList.remove('hidden');
    else w.classList.add('hidden');

    var panel = document.getElementById('warn-panel');
    panel.classList.remove('hidden');
});

socket.on("warn", function(html) {
    var w = document.getElementById('warn-warn-text');
    w.innerHTML = html;

    w = document.getElementById('warn-warn');
    if(html) w.classList.remove('hidden');
    else w.classList.add('hidden');

    var panel = document.getElementById('warn-panel');
    panel.classList.remove('hidden');
});

function warn_ok() {
    var panel = document.getElementById('warn-panel');
    panel.classList.add('hidden');
}

function layout_add(delta) {
    p = document.getElementById('layout-page');
    socket.emit("layout-add", [p.textContent, delta]);
}

socket.on("layout-set-page", function(data) {
    p = document.getElementById('layout-page');
    if(p) p.textContent = data[0];
    o = document.getElementById('layout-svg');
    if(o) o.setAttribute("data", data[1])
});
