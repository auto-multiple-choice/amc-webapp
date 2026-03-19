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

function connection_status(s) {
    cs = document.getElementById('connection-status');
    for(x of ["online", "offline"]) {
        if(x==s) cs.classList.add(x);
        else cs.classList.remove(x);
    }
}

var projects_action = null;

function select_action(e) {
    projects_action = e.id;
    for(x of document.getElementsByClassName("project-action")) {
        x.classList.remove("selected");
    }
    pul = document.getElementById("projects-ul");
    for(c of ["ok", "neutral", "danger"]) {
        pul.classList.remove(c);
    }
    for(c of ["ok", "neutral", "danger"]) {
        if(e.classList.contains(c))
            pul.classList.add(c);
    }
    e.classList.add("selected");
}

function project_rename(name) {
    li = null;
    for(i of document.getElementsByClassName("project-name")) {
        if(i.textContent == name) {
            li = i;
        }
    }
    if(li != null) {
        inp = document.createElement("input");
        inp.setAttribute("type", "text");
        inp.setAttribute("id", "project-rename");
        inp.setAttribute("name", "project-rename");
        inp.setAttribute("onchange", "project_do_rename(this);");
        inp.setAttribute("onkeyup", "project_rename_key(this, event);");
        inp.setAttribute("oldname", name);
        inp.setAttribute("class", "project-change-name");
        inp.value = name;
        li.textContent = "";
        li.appendChild(inp);
    }
}

function project_rename_key(e, event) {
    if(event.key === "Escape") {
        var name = e.getAttribute("oldname");
        var p = e.parentElement;
        p.innerHTML = '';
        p.textContent = name;
    }
}

function project_do_rename(e) {
    socket.emit("project-rename", [e.getAttribute("oldname"), e.value]);
}

function select_project(name) {
    switch(projects_action) {
    case "project-open":
        project_name = name;
        document.getElementById('project-name').innerHTML = name;
        tab_source();
        break;
    case "project-rename":
        project_rename(name);
        break;
    case "project-delete":
        if(!confirm(`Are you sure you want to delete project "${name}"? This will permanentely delete all related files.`))
            break;
    case "project-clone":
        socket.emit(projects_action, name);
        break;
    default:
        console.log(`Unknown action: ${projects_action}.`);
    }
}

socket.on("projects-list", function(html) {
    var list = document.getElementById('projects-list');
    if(list) {
        projects_action = "project-open"
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

socket.on("connect", () => {
    connection_status("online");
    socket.emit("project-name", project_name);
});

socket.on("disconnect", () => {
    connection_status("offline");
});

function change_ncopies() {
    socket.emit("ncopies",
                document.getElementById('ncopies').value);
}

socket.on("document-content", function(data) {
    var pb = document.getElementById('doc-print-btn');
    if(pb) {
        if(data[0]) pb.classList.remove("hidden");
        else pb.classList.add("hidden");
    }
    var du = document.getElementById('doc-update');
    if(du) {
        if(document.getElementById('doc-type').value)
            du.classList.remove('disabled');
        else du.classList.add('disabled');
    }
    var view = document.getElementById('document-view');
    if(view) {
        view.innerHTML = data[1];
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

socket.on("dialog", function(html) {
    var w = document.getElementById('warn-content');
    w.innerHTML = html;
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

function doc_print() {
    document.getElementById('code').classList.add("hidden");
    document.getElementById('print').classList.remove("hidden");
    socket.emit("print-dialog");
}

socket.on("print-dialog", function(data) {
    document.getElementById('print').innerHTML = data;
});

function doc_print_finished() {
    document.getElementById('code').classList.remove("hidden");
    document.getElementById('print').classList.add("hidden");
}

socket.on("print-done", function(data) {
    doc_print_finished();
});

function print_range() {
    return [document.getElementById('student1').value,
            document.getElementById('student2').value];
}

function print_to_printer() {
    var p = document.getElementById('printer').value;
    socket.emit("print-to-printer",
                [ ...print_range(), p]);
}

function print_to_files() {
    var b = document.getElementById('print-files-btn');
    socket.emit("print-to-files", print_range());
}

socket.on("print-to-files", function(url) {
    window.location.href = url;
    doc_print_finished();
});

