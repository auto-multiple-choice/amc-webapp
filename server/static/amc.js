var socket = io();

var project_name = null;
var editor = null;
var current_tab = null;

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
            set_current_tab(tab_name);
        })
        .catch(error => {
            console.error('There has been a problem with your fetch operation:', error);
        });
}

function set_current_tab(tab_name) {
    current_tab = tab_name;
    for(var e of document.getElementsByClassName("menubtn")) {
        var name = e.id.substring(5);
        if(name == current_tab) e.classList.add("current");
        else e.classList.remove("current");
        if(name == "main") {
            if(tab_name == "main") e.classList.remove("hidden");
            else e.classList.add("hidden");
        }
    }
}

function adapt_menu(data) {
    for(var e of document.getElementsByClassName("menubtn")) {
        var name = e.id.substring(5);
        if(data[name] || name == current_tab) e.classList.remove("hidden");
        else e.classList.add("hidden");
    }
}

socket.on("menu", adapt_menu);

function connection_status(s) {
    var cs = document.getElementById('connection-status');
    if(cs) {
        for(x of ["online", "offline"]) {
            if(x==s) cs.classList.add(x);
            else cs.classList.remove(x);
        }
    } else {
        console.error("Can't find connection-status")
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
    var li = null;
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

function project_open(name) {
    project_name = name;
    localStorage.setItem("project-name", name)
    document.getElementById('project-name').innerHTML = name;
    tab_source();
}

socket.on("project-open", project_open );

function select_project(name) {
    switch(projects_action) {
    case "project-open":
        project_open(name);
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

socket.on("project-new", function(html) {
    var part = document.getElementById('project-new');
    if(part) {
        part.innerHTML = html;
    }
});

function tab_main() {
    show_tab("main").then(() => {
        socket.emit("projects-list");
        socket.emit("project-new");
    });
}

function template_group_select(gid) {
    var tlist = document.getElementById('template-list');
    for (t of tlist.children) {
        if(t.getAttribute("gid") === gid || gid === "")
            t.classList.remove("hidden");
        else
            t.classList.add("hidden");
    }
}

function upload_file(url, file,
                     message,
                     params={}, callback=null) {
    const formData = new FormData();
    formData.append('file', file);
    for(k of Object.keys(params)) {
        formData.append(k, params[k]);
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
            set_p(e.loaded / e.total);
        }
    };
    xhr.onreadystatechange = () => {
        if (xhr.readyState == XMLHttpRequest.DONE) {
            if (xhr.status === 200) {
                console.log("Upload response: " + xhr.responseText);
                var r = JSON.parse(xhr.responseText);
                if(r["ok"]) {
                    if(callback) callback();
                } else {
                    alert("Error: " + r["error"]);
                }
            } else {
                alert(`Error: upload failed (status ${xhr.status})`);
            }
        }
    };
    begin_command(message);
    xhr.send(formData);
}

function upload_file_to_project_done() {
    var uf = document.getElementById('project-upload-file');
    uf.classList.add("hidden");
    uf.value = "";
    all_files_change();
}

function upload_file_to_project() {
    var f = document.getElementById('project-upload-file');
    if(f.files[0]) {
        upload_file(`/${socket.id}/upload/project`,
                    f.files[0], "Uploading…", {},
                    upload_file_to_project_done
                   );
    }
}

function delete_project_file(filename) {
    var all_files = document.getElementById("all-files").checked;
    if(confirm(`Are you sure you want to delete ${filename}?`)) {
        socket.emit("project-delete-file", [filename, all_files]);
    }
}

function do_create_project() {
    var name = document.getElementById('new-project-name').value;
    var way = document.querySelector('input[name="way"]:checked').value;
    if(name === "") {
        alert("Please choose a name for your new project!");
        return;
    }
    if(way == "empty") {
        var stype = document.getElementById('source-type').value;
        socket.emit("create-project-empty", [name, stype]);
    } else if(way == "template") {
        var tid = document.querySelector('input[name="tid"]:checked');
        if(tid === null) {
            alert("Please choose a template!");
            return;
        }
        tid = tid.value;
        socket.emit("create-project-template", [name, tid]);
    } else if(way == "file") {
        var f = document.getElementById('source-file');
        if(f.files[0]) {
            upload_file(`/${socket.id}/upload/create`,
                        f.files[0], "Uploading…",
                        { "name": name },
                        function() { project_open(name); }
                       )
        } else {
            alert("Please choose a file to send!");
        }
    } else {
        console.error("Unknown way: " + way)
    }
}

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
    var nc = document.getElementById('ncopies');
    if(nc) {
        nc.value = n;
    }
});

function source_modified(t) {
    for(const i of ["source-save", "source-revert"]) {
        var b = document.getElementById(i);
        if(b) {
            if(t) b.classList.remove("disabled");
            else b.classList.add("disabled");
        }
    }
}

socket.on("source-code", function(data) {
    var cc = document.getElementById('code-code');
    if(cc) {
        if(!editor) {
            editor = ace.edit("code-code");
            editor.setTheme("ace/theme/textmate");
            editor.session.on('change', function(delta) {
                source_modified(true);
            });
        }
        editor.session.setMode("ace/mode/" + data[0]);
        editor.session.setValue(data[1], -1);
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
    var list = document.getElementById('files-list-list');
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

function all_files_change() {
    var all_files = document.getElementById("all-files").checked;
    socket.emit("files-list", all_files);
}

function source_other() {
    var fl = document.getElementById("files-list");
    if(fl.classList.contains("hidden")) {
        fl.classList.remove("hidden");
        document.getElementById("all-files").checked = false;
        document.getElementById("project-upload-file").classList.add("hidden");
        all_files_change();
    } else {
        fl.classList.add("hidden");
    }
}

function open_upload_file() {
    document.getElementById("project-upload-file").classList.remove("hidden");
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

        if(data[1]) du.classList.add('danger');
        else du.classList.remove('danger');
    }
    var view = document.getElementById('document-view');
    if(view) {
        view.innerHTML = data[2];
    }
});

function change_doc_type() {
    var t = document.getElementById('doc-type').value;
    var upd = document.getElementById('doc-update');
    if(t == "calage") upd.classList.add("hidden");
    else upd.classList.remove("hidden");
    socket.emit("doc-type", t);
}

function doc_update(e) {
    if(e.classList.contains("danger")) {
        if(!confirm("Warning! Rebuilding the subject will remove all the project data. To allow the use of an already printed question, cancel!"))
            return;
    }
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

function begin_command(message="") {
    set_t(message);
    set_p(0);
    var panel = document.getElementById('info-panel');
    panel.classList.remove('hidden');
}

socket.on("begin-command", begin_command);

function end_command() {
    var panel = document.getElementById('info-panel');
    panel.classList.add('hidden');
}

socket.on("end-command", end_command);

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
    var p = document.getElementById('layout-page');
    socket.emit("layout-add", [p.textContent, delta]);
}

socket.on("layout-set-page", function(data) {
    var p = document.getElementById('layout-page');
    if(p) p.textContent = data[0];
    var o = document.getElementById('layout-svg');
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

function open_file(url) {
    window.location.href = url;
}

socket.on("print-to-files", function(url) {
    open_file(url);
    doc_print_finished();
});

function scans_mode_change() {
    var m = document.getElementById('scans-photocopied').checked;
    socket.emit("scans-mode-change", (m ? 1 : 0));
}

socket.on("scans-mode", function(m) {
    var sm = document.getElementById('scans-photocopied');
    if(sm) {
        sm.checked = (m == 1);
    }
});

socket.on("lock-photocopy", function() {
    var p = document.getElementById('scans-photocopied');
    p.disabled = true;
});
socket.on("unlock-photocopy", function() {
    var p = document.getElementById('scans-photocopied');
    p.disabled = false;
});

socket.on("thresholds", function(data) {
    var d;
    d = document.getElementById("threshold");
    if(d) d.value = parseFloat(data[0]);
    d = document.getElementById("threshold-up");
    if(d) d.value = parseFloat(data[1]);
});

function threshold_change() {
    var threshold = document.getElementById("threshold").value;
    var threshold_up = document.getElementById("threshold-up").value;
    socket.emit("set-thresholds", [ threshold, threshold_up ]);
}

socket.on("scans-report", function(html) {
    var report = document.getElementById('scans-report');
    if(report) {
        report.innerHTML = html;
    }
});

function tab_scans() {
    show_tab("scans").then(() => {
        socket.emit("scans-mode");
        socket.emit("scans-report");
    });
}

function update_zoom_ticked(question, answer) {
    var x = document.getElementById("box1_" + question + "_" + answer);
    if(x) {
        var y;
        for(y of document.querySelectorAll("div[amc-question=\"" + question + "\"][amc-answer=\"" + answer + "\"]")) {
            if(x.classList.contains("ticked")) {
                y.classList.remove("not-ticked");
                y.classList.add("ticked");
            } else {
                y.classList.remove("ticked");
                y.classList.add("not-ticked");
            }
        }
    } else {
        console.log("Rect not found", question, answer);
    }
}

function update_all_zooms_ticked() {
    var x;
    for(x of document.getElementsByClassName("box1")) {
        var i = x.getAttribute("id").split("_");
        update_zoom_ticked(i[1], i[2]);
    }
    setTimeout(() => {
        var z;
        z = document.getElementById('zooms-0');
        z.scrollTo(0, z.scrollHeight);
        z = document.getElementById('zooms-1');
        z.scrollTo(0, 0);
    });
}

function allow_manual_revert(ok) {
    var r = document.getElementById("manual-revert");
    if(ok) {
        r.classList.remove("hidden");
    } else {
        r.classList.add("hidden");
    }
    r = document.getElementsByClassName("selected pagerow")[0];
    r.setAttribute("amc-manual", ok ? "1" : "0");
}

socket.on("allow-revert", ()=> allow_manual_revert(true));
socket.on("disallow-revert", ()=> allow_manual_revert(false));

socket.on("scans-manual", function(html) {
    var manual = document.getElementById('manual');
    if(manual) {
        manual.innerHTML = html;

        var s = document.getElementsByClassName("selected pagerow")[0];
        allow_manual_revert(s.getAttribute("amc-manual") == "1");

        update_all_zooms_ticked();
    }
});

function revert_manual() {
    var v = document.getElementById('manual-view');
    socket.emit(
        "revert-manual",
        [ v.getAttribute("amc-student"),
          v.getAttribute("amc-page"),
          v.getAttribute("amc-copy") ]
    );
}

socket.on("scans-zooms", function(html) {
    var z0 = document.getElementById('zooms-0');
    if(z0) {
        z0.innerHTML = html;
    }
    var z1 = document.getElementById('zooms-1');
    if(z1) {
        z1.innerHTML = html;
    }
});

function highlight_selected_page(e, student, page, copy) {
    if(e == null) {
        e = document.querySelector(`.pagerow[amc-student="${student}"][amc-page="${page}"][amc-copy="${copy}"]`);
    }
    for(old of document.getElementsByClassName("selected pagerow")) {
        old.classList.remove("selected");
    }
    if(e) e.classList.add("selected");
}

function scans_page_select(e, student, page, copy) {
    highlight_selected_page(e, student, page, copy);
    socket.emit("scans-page-select", [student,page,copy]);
}

socket.on("scans-page-select", function(data) {
    highlight_selected_page(null, ...data);
});

socket.on("tick-box", function(data) {
    var question = data[0];
    var answer = data[1];
    var ticked = data[2];
    var b = document.getElementById(`box1_${question}_${answer}`);
    if(b) {
        if(ticked)
            b.classList.add("ticked");
        else
            b.classList.remove("ticked");
    }
    update_zoom_ticked(question, answer);
});

function compare_reports(a, b, column) {
    var x = 0;
    if(column) {
        x = parseFloat(b.getAttribute("amc-" + column)) - parseFloat(a.getAttribute("amc-" + column));
    }
    if(x==0) {
        x = parseInt(a.getAttribute("amc-student")) - parseInt(b.getAttribute("amc-student"));
    }
    if(x==0) {
        x = parseInt(a.getAttribute("amc-copy")) - parseInt(b.getAttribute("amc-copy"));
    }
    if(x==0) {
        x = parseInt(a.getAttribute("amc-page")) - parseInt(b.getAttribute("amc-page"));
    }
    return(x);
}

function scans_report_sort(column) {
    rows = Array.from(document.getElementsByClassName("pagerow")).sort((a,b)=> compare_reports(a,b,column));
    c = document.getElementById("scans-pages-rows");
    for(r of rows) {
        c.appendChild(r);
    }
}

function clickBox(question, answer) {
    var mv = document.getElementById('manual-view');
    var b = document.getElementById(`box1_${question}_${answer}`);
    if(mv && b) {
        console.log(`Click on box(${question}/${answer})`);
        var ticked = !b.classList.contains("ticked");
        socket.emit("set-manual",
                    [ mv.getAttribute("amc-student"),
                      mv.getAttribute("amc-page"),
                      mv.getAttribute("amc-copy"),
                      question, answer, ticked ]);
    }
}

function upload_scans_done() {
    console.log("Scans uploaded.");
}

function upload_scans() {
    var f = document.getElementById('scans-upload');
    if(f.files[0]) {
        upload_file(`/${socket.id}/upload/scans`,
                    f.files[0], "Uploading…", { "project_name": project_name },
                    upload_scans_done
                   );
    }
}

function add_student() {
    var student = parseInt(document.getElementById('add-student-n').value);
    socket.emit("add-student", student);
    document.getElementById('add-student-n').value = "";
}

// ----------------------- GRADING

function tab_grading() {
    show_tab("grading").then(() => {
        socket.emit("show-marks");
        socket.emit("identification");
        socket.emit("export-config");
        socket.emit("exported-files", null);
        socket.emit("annotation-config");
        socket.emit("annotated-files", null);
    });
}

socket.on("identification", function(html) {
    var i = document.getElementById('identification');
    if(i) {
        i.innerHTML = html;
    }
});

function do_mark() {
    var u = document.getElementById('extract-scale').checked;
    socket.emit("do-mark", u);
}

socket.on("show-marks", function(html) {
    var i = document.getElementById('marks-report');
    if(i) {
        i.innerHTML = html;
    }
});

function change_lkey(e, fixed) {
    if(fixed) {
        if(confirm("Do you really want to change this key? This will cancel all the papers/students associations!")) {
            socket.emit("change-lkey", [e.value, true]);
        } else {
            e.value = fixed;
        }
    } else {
        socket.emit("change-lkey", [e.value, false]);
    }
}

function change_acode(e) {
    socket.emit("change-acode", e.value);
}

function association_auto() {
    socket.emit("association-auto");
}

function association_manual() {
    document.getElementById("grading").classList.add("hidden");
    document.getElementById("association").classList.remove("hidden");
    socket.emit("assoc-sheets");
    socket.emit("students-list");
}

function association_manual_done() {
    document.getElementById("association").classList.add("hidden");
    document.getElementById("grading").classList.remove("hidden");
    socket.emit("identification");
}

function association_clear() {
    if(confirm("Are you sure you want to delete all association data?")) {
        socket.emit("association-clear");
    }
}

socket.on("assoc-sheets", function(html) {
    var e = document.getElementById("assoc-sheets");
    if(e) {
        e.innerHTML = html;
    }
    select_assoc_sheet(-1,-1);
    first_not_associated();
});

socket.on("namefield", function(html) {
    var e = document.getElementById("studentname");
    if(e) {
        e.innerHTML = html;
    }
});

socket.on("students-list", function(html) {
    var e = document.getElementById("students-list");
    if(e) {
        e.innerHTML = html;
    }
});

var assoc_sheet = [-1,-1];

function student_highlight(id) {
    var e;
    for(e of document.querySelectorAll("#students-list li.student-name")) {
        e.classList.remove("highlight");
    }
    if(id != "None") {
        e = document.querySelector(
            `#students-list li.student-name[amc-id="${id}"]`
        );
        if(e)
            e.classList.add("highlight");
    }
}

function select_assoc_sheet(e, student, copy) {
    if(student >= 0) {
        socket.emit("select-assoc-sheet", [student, copy]);
        var x;
        for(x of document.querySelectorAll("#assoc-sheets tr"))
            x.classList.remove("selected");
        e.classList.add("selected");
        var auto = e.getAttribute("amc-auto");
        var manual = e.getAttribute("amc-manual");
        student_highlight(manual == "None" ? auto : manual);
    } else {
        var e = document.getElementById("studentname");
        if(e) {
            e.innerHTML = "";
        }
        student_highlight("None");
    }
    assoc_sheet = [student, copy];
}

function first_not_associated() {
    var e = document.querySelector('#assoc-sheets tr[amc-auto="None"][amc-manual="None"]');
    if(e) {
        select_assoc_sheet(e,
                           parseInt(e.getAttribute("amc-student")),
                           parseInt(e.getAttribute("amc-copy")));
        e.scrollIntoView();
    }
}

function select_student_name(e) {
    var student_id = e.getAttribute("amc-id");
    socket.emit("associate", [...assoc_sheet, student_id]);
}

function set_association_student(student_id, associated) {
    var e = document.querySelector(
        `li.student-name[amc-id="${student_id}"]`
    );
    if(e) {
        if(associated)
            e.classList.add("associated");
        else
            e.classList.remove("associated");
    }
}

function set_association(student, copy, student_id) {
    var e = document.querySelector(
        `#assoc-sheets tbody tr[amc-student="${student}"][amc-copy="${copy}"]`
    );
    if(e) {
        var auto = e.getAttribute("amc-auto");
        var manual = e.getAttribute("amc-manual");
        var old = (manual=="None" ? auto : manual);
        set_association_student(old, false);
        e.setAttribute("amc-manual", student_id);
        set_association_student(student_id, true);
    }
}

socket.on("update-association", function(data) {
    var student = data[0];
    var copy = data[1];
    var student_id = data[2];
    var to_rm = data[3];
    
    for(sc of to_rm) {
        set_association(sc[0], sc[1], "");
    }
    set_association(student, copy, student_id);
    if(student == assoc_sheet[0]
       && copy == assoc_sheet[1]) {
        student_highlight(student_id);
    }
    first_not_associated();
});

function change_export_module(e) {
    if(!e) e = document.getElementById("format_export");
    change_config_value(e);
    var module = e.value;
    for(const m of ["ods", "CSV"]) {
        var x = document.getElementById("export-" + m);
        if(m == module) x.classList.remove("hidden");
        else x.classList.add("hidden");
    }
}

function change_config_value(e) {
    var value;
    if(e.type == "checkbox")
        value = (e.checked ? "on" : "");
    else if(e.type == "select-one" || e.type == "text")
        value = e.value;
    else {
        console.log("Unknown type: " + e.type);
        return;
    }
    socket.emit("set-config", [e.getAttribute("id"), value]);
}

socket.on("selected-config", function(data) {
    for(var k in data) {
        var e = document.getElementById(k);
        if(e) {
            if(e.type == "checkbox")
                e.checked = Boolean(data[k]);
            else if(e.type == "select-one" || e.type == "text")
                e.value = data[k];
            else
                console.log("Unknown type: " + e.type);
            if(!e.getAttribute("onchange"))
                e.setAttribute("onchange", "change_config_value(this);");

            if(k=="format_export") change_export_module();
        }
    }
});

function do_export() {
    socket.emit("do-export");
}

socket.on("exported-files", function(html) {
    var i = document.getElementById('exported-files');
    if(i) {
        i.innerHTML = html;
    }
});

function do_annotate() {
    socket.emit("do-annotate");
}

socket.on("annotated-files", function(html) {
    var i = document.getElementById('annotated-files');
    if(i) {
        i.innerHTML = html;
    }
});

// ----------------------- MAIN

document.addEventListener('DOMContentLoaded', function() {
    project_name = localStorage.getItem("project-name");
    if(project_name) {
        project_open(project_name);
    } else {
        tab_main();
        adapt_menu({"main": true});
    }
});

