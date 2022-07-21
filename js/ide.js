var SERVER_NAME = "SERVER_NAME_HERE";
var defaultUrl = `http://localhost:8888/` ||
  localStorageGetItem("api-url");
var apiUrl = defaultUrl;
var tpmManagerUrl = `https://${SERVER_NAME}.usable-tpm.site:4004`;
var wait = localStorageGetItem("wait") || true;
var check_timeout = 300;

var blinkStatusLine = ((localStorageGetItem("blink") || "true") === "true");
var editorMode = localStorageGetItem("editorMode") || "normal";
var editorModeObject = null;

var fontSize = 14;

var MonacoVim;
var MonacoEmacs;

var layout;

var sourceEditor;
var stdinEditor;
var stdoutEditor;

var isEditorDirty = false;
var currentLanguageId;

var $selectLanguage;
var $compilerOptions;
var $commandLineArguments;
var $insertTemplateBtn;
var $runBtn;
var $rebootBtn;
var $resetBtn;
var $updates;
var $statusLine;

var timeStart;
var timeEnd;

var defaultLanguageId = 2001;

var messagesData;

var layoutConfig = {
    settings: {
        showPopoutIcon: false,
        reorderEnabled: true
    },
    dimensions: {
        borderWidth: 3,
        headerHeight: 22
    },
    content: [{
        type: "column",
        content: [{
            type: "component",
            height: 70,
            componentName: "source",
            id: "source",
            title: "SOURCE",
            isClosable: false,
            componentState: {
                readOnly: false
            }
        }, {
            type: "stack",
            content: [{
                type: "component",
                componentName: "stdout",
                id: "stdout",
                title: "Output",
                isClosable: false,
                componentState: {
                    readOnly: true
                }
            }, {
                type: "component",
                componentName: "stderr",
                id: "stderr",
                title: "STDERR",
                isClosable: false,
                componentState: {
                    readOnly: true
                }
            }, {
                type: "component",
                componentName: "compile output",
                id: "compileoutput",
                title: "COMPILE OUTPUT",
                isClosable: false,
                componentState: {
                  readOnly: true,
                }
            }]
        }]
    }]
};

function encode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

function decode(bytes) {
    var escaped = escape(atob(bytes || ""));
    try {
        return decodeURIComponent(escaped);
    } catch {
        return unescape(escaped);
    }
}

function localStorageSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (ignorable) {
  }
}

function localStorageGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (ignorable) {
    return null;
  }
}

function showError(title, content) {
    $("#site-modal #title").html(title);
    $("#site-modal .content").html(content);
    $("#site-modal").modal("show");
}

function handleError(jqXHR, textStatus, errorThrown) {
    showError(`${jqXHR.statusText} (${jqXHR.status})`, `<pre>${JSON.stringify(jqXHR, null, 4)}</pre>`);
}

function handleRunError(jqXHR, textStatus, errorThrown) {
    handleError(jqXHR, textStatus, errorThrown);
    $runBtn.removeClass("loading");
}

function handleResult(data) {
    timeEnd = performance.now();
    console.log("It took " + (timeEnd - timeStart) + " ms to get submission result.");

    var status = data.status;
    var stdout = decode(data.stdout);
    var compile_output = decode(data.compile_output);
    var time = (data.time === null ? "-" : data.time + "s");
    var memory = (data.memory === null ? "-" : data.memory + "KB");

    $statusLine.html(`${status.description}, ${time}, ${memory}`);

    if (blinkStatusLine) {
        $statusLine.addClass("blink");
        setTimeout(function() {
            blinkStatusLine = false;
            localStorageSetItem("blink", "false");
            $statusLine.removeClass("blink");
        }, 3000);
    }

    var output = [compile_output, stdout].join("\n").trim();

    stdoutEditor.setValue(output);

    if (output !== "") {
        var dot = document.getElementById("stdout-dot");
        if (!dot.parentElement.classList.contains("lm_active")) {
            dot.hidden = false;
        }
    }

    $runBtn.removeClass("loading");
}

function getIdFromURI() {
  var uri = location.search.substr(1).trim();
  return uri.split("&")[0];
}

function downloadSource() {
    var value = parseInt($selectLanguage.val());
    download(sourceEditor.getValue(), fileNames[value], "text/plain");
}

function loadSavedSource() {
    snippet_id = getIdFromURI();

    if (snippet_id.length == 36) {
        $.ajax({
            url: apiUrl + "/submissions/" + snippet_id + "?fields=source_code,language_id,stdin,stdout,stderr,compile_output,message,time,memory,status,compiler_options,command_line_arguments&base64_encoded=true",
            type: "GET",
            success: function(data, textStatus, jqXHR) {
                sourceEditor.setValue(decode(data["source_code"]));
                $selectLanguage.dropdown("set selected", data["language_id"]);
                $compilerOptions.val(data["compiler_options"]);
                $commandLineArguments.val(data["command_line_arguments"]);
                stdinEditor.setValue(decode(data["stdin"]));
                stdoutEditor.setValue(decode(data["stdout"]));
                var time = (data.time === null ? "-" : data.time + "s");
                var memory = (data.memory === null ? "-" : data.memory + "KB");
                $statusLine.html(`${data.status.description}, ${time}, ${memory}`);
                changeEditorLanguage();
            },
            error: handleRunError
        });
    } else {
        loadRandomLanguage();
    }
}

function rebootTPM() {
  $rebootBtn.addClass("loading");
  console.log("Rebooting the TPM");
  $.ajax({
    url: `${tpmManagerUrl}/restart_tpm`,
    type: "POST",
    success: function (data, textStatus, jqXHR) {
      console.log("Your TPM was rebooted");
      $rebootBtn.removeClass("loading");
    },
    error: handleRebootError,
  });
}

function resetTPM() {
  $resetBtn.addClass("loading");
  console.log("Resetting the TPM");
  $.ajax({
    url: `${tpmManagerUrl}/reset_tpm`,
    type: "POST",
    success: function (data, textStatus, jqXHR) {
      console.log("Your TPM was reset");
      $resetBtn.removeClass("loading");
    },
    error: handleResetError,
  });
}

function run() {
    if (sourceEditor.getValue().trim() === "") {
        showError("Error", "Source code can't be empty!");
        return;
    } else {
        $runBtn.addClass("loading");
    }

    document.getElementById("stdout-dot").hidden = true;

    stdoutEditor.setValue("");

    var x = layout.root.getItemsById("stdout")[0];
    x.parent.header.parent.setActiveContentItem(x);

    var sourceValue = encode(sourceEditor.getValue().replaceAll("\r", ""));
    var stdinValue = encode(stdinEditor.getValue());
    var languageId = resolveLanguageId($selectLanguage.val());
    var compilerOptions = $compilerOptions.val();
    var commandLineArguments = $commandLineArguments.val();

    if (parseInt(languageId) === 44) {
        sourceValue = sourceEditor.getValue();
    }

    var data = {
        source_code: sourceValue,
        language_id: languageId,
        stdin: stdinValue,
        compiler_options: compilerOptions,
        command_line_arguments: commandLineArguments,
        redirect_stderr_to_stdout: true
    };

    var sendRequest = function(data) {
        const params = new URLSearchParams(window.location.search);

        // ! Temporary hack to get what task we are in.
        if (params.has("task")) {
        const task = params.get("task");
        data["task"] = task;
        }

        timeStart = performance.now();
        $.ajax({
            url: apiUrl + `/submissions?base64_encoded=true&wait=${wait}`,
            type: "POST",
            async: true,
            contentType: "application/json",
            data: JSON.stringify(data),
            xhrFields: {
                withCredentials: apiUrl.indexOf("/secure") != -1 ? true : false
            },
            success: function (data, textStatus, jqXHR) {
                console.log(`Your submission token is: ${data.token}`);
                if (wait == true) {
                    handleResult(data);
                } else {
                    setTimeout(fetchSubmission.bind(null, data.token), check_timeout);
                }
            },
            error: handleRunError
        });
    }

    var fetchAdditionalFiles = false;
    if (parseInt(languageId) === 82) {
        if (sqliteAdditionalFiles === "") {
            fetchAdditionalFiles = true;
            $.ajax({
                url: `https://minio.judge0.com/public/ide/sqliteAdditionalFiles.base64.txt?${Date.now()}`,
                type: "GET",
                async: true,
                contentType: "text/plain",
                success: function (responseData, textStatus, jqXHR) {
                    sqliteAdditionalFiles = responseData;
                    data["additional_files"] = sqliteAdditionalFiles;
                    sendRequest(data);
                },
                error: handleRunError
            });
        }
        else {
            data["additional_files"] = sqliteAdditionalFiles;
        }
    }

    if (!fetchAdditionalFiles) {
        sendRequest(data);
    }
}

function fetchSubmission(submission_token) {
    $.ajax({
        url: apiUrl + "/submissions/" + submission_token + "?base64_encoded=true",
        type: "GET",
        async: true,
        success: function (data, textStatus, jqXHR) {
            if (data.status.id <= 2) { // In Queue or Processing
                setTimeout(fetchSubmission.bind(null, submission_token), check_timeout);
                return;
            }
            handleResult(data);
        },
        error: handleRunError
    });
}

function changeEditorLanguage() {
    monaco.editor.setModelLanguage(sourceEditor.getModel(), $selectLanguage.find(":selected").attr("mode"));
    currentLanguageId = parseInt($selectLanguage.val());
    $(".lm_title")[0].innerText = fileNames[currentLanguageId];
    apiUrl = resolveApiUrl($selectLanguage.val());
}

function insertTemplate() {
    currentLanguageId = parseInt($selectLanguage.val());
    sourceEditor.setValue(sources[currentLanguageId]);
    stdinEditor.setValue(inputs[currentLanguageId] || "");
    $compilerOptions.val(compilerOptions[currentLanguageId] || "");
    changeEditorLanguage();
}

function loadRandomLanguage() {
    var values = [];
    for (var i = 0; i < $selectLanguage[0].options.length; ++i) {
        values.push($selectLanguage[0].options[i].value);
    }
    // $selectLanguage.dropdown("set selected", values[Math.floor(Math.random() * $selectLanguage[0].length)]);
    $selectLanguage.dropdown("set selected", values[46]);
    insertTemplate();
}

function resizeEditor(layoutInfo) {
    if (editorMode != "normal") {
        var statusLineHeight = $("#editor-status-line").height();
        layoutInfo.height -= statusLineHeight;
        layoutInfo.contentHeight -= statusLineHeight;
    }
}

function disposeEditorModeObject() {
    try {
        editorModeObject.dispose();
        editorModeObject = null;
    } catch(ignorable) {
    }
}

function changeEditorMode() {
    disposeEditorModeObject();

    if (editorMode == "vim") {
        editorModeObject = MonacoVim.initVimMode(sourceEditor, $("#editor-status-line")[0]);
    } else if (editorMode == "emacs") {
        var statusNode = $("#editor-status-line")[0];
        editorModeObject = new MonacoEmacs.EmacsExtension(sourceEditor);
        editorModeObject.onDidMarkChange(function(e) {
          statusNode.textContent = e ? "Mark Set!" : "Mark Unset";
        });
        editorModeObject.onDidChangeKey(function(str) {
          statusNode.textContent = str;
        });
        editorModeObject.start();
    }
}

function resolveLanguageId(id) {
    id = parseInt(id);
    return languageIdTable[id] || id;
}

function editorsUpdateFontSize(fontSize) {
    sourceEditor.updateOptions({fontSize: fontSize});
    stdinEditor.updateOptions({fontSize: fontSize});
    stdoutEditor.updateOptions({fontSize: fontSize});
}

function updateScreenElements() {
    var display = window.innerWidth <= 1200 ? "none" : "";
    $(".wide.screen.only").each(function(index) {
        $(this).css("display", display);
    });
}

$(window).resize(function() {
    layout.updateSize();
    updateScreenElements();
    showMessages();
});

$(document).ready(function () {
    updateScreenElements();

    $selectLanguage = $("#select-language");
    $selectLanguage.change(function (e) {
        if (!isEditorDirty) {
            insertTemplate();
        } else {
            changeEditorLanguage();
        }
    });

    $compilerOptions = $("#compiler-options");
    $commandLineArguments = $("#command-line-arguments");
    $commandLineArguments.attr("size", $commandLineArguments.attr("placeholder").length);

    $insertTemplateBtn = $("#insert-template-btn");
    $insertTemplateBtn.click(function (e) {
        if (isEditorDirty && confirm("Are you sure? Your current changes will be lost.")) {
            insertTemplate();
        }
    });

    $runBtn = $("#run-btn");
    $runBtn.click(function (e) {
        run();
    });

    $rebootBtn = $("#reboot-btn");
    $rebootBtn.click(function (e) {
      rebootTPM();
    });
     $resetBtn = $("#reset-btn");
    $resetBtn.click(function (e) {
      resetTPM();
    });

    $(`input[name="editor-mode"][value="${editorMode}"]`).prop("checked", true);
    $("input[name=\"editor-mode\"]").on("change", function(e) {
        editorMode = e.target.value;
        localStorageSetItem("editorMode", editorMode);

        resizeEditor(sourceEditor.getLayoutInfo());
        changeEditorMode();

        sourceEditor.focus();
    });

    $statusLine = $("#status-line");

    $(document).on("keydown", "body", function (e) {
        var keyCode = e.keyCode || e.which;
        if (keyCode == 120) { // F9
            e.preventDefault();
            run();
        } else if (keyCode == 119) { // F8
            e.preventDefault();
            var url = prompt("Enter URL of Judge0 API:", apiUrl);
            if (url != null) {
                url = url.trim();
            }
            if (url != null && url != "") {
                apiUrl = url;
                localStorageSetItem("api-url", apiUrl);
            }
        } else if (keyCode == 118) { // F7
            e.preventDefault();
            wait = !wait;
            localStorageSetItem("wait", wait);
            alert(`Submission wait is ${wait ? "ON. Enjoy" : "OFF"}.`);
        } else if (event.ctrlKey && keyCode == 107) { // Ctrl++
            e.preventDefault();
            fontSize += 1;
            editorsUpdateFontSize(fontSize);
        } else if (event.ctrlKey && keyCode == 109) { // Ctrl+-
            e.preventDefault();
            fontSize -= 1;
            editorsUpdateFontSize(fontSize);
        }
    });

    $("select.dropdown").dropdown();
    $(".ui.dropdown").dropdown();
    $(".ui.dropdown.site-links").dropdown({action: "hide", on: "hover"});
    $(".ui.checkbox").checkbox();
    $(".message .close").on("click", function () {
        $(this).closest(".message").transition("fade");
    });

    require(["vs/editor/editor.main", "monaco-vim", "monaco-emacs"], function (ignorable, MVim, MEmacs) {
        layout = new GoldenLayout(layoutConfig, $("#site-content"));

        MonacoVim = MVim;
        MonacoEmacs = MEmacs;

        layout.registerComponent("source", function (container, state) {
            sourceEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                theme: "vs-dark",
                scrollBeyondLastLine: true,
                readOnly: state.readOnly,
                language: "cpp",
                minimap: {
                    enabled: false
                }
            });

            changeEditorMode();

            sourceEditor.getModel().onDidChangeContent(function (e) {
                currentLanguageId = parseInt($selectLanguage.val());
                isEditorDirty = sourceEditor.getValue() != sources[currentLanguageId];
            });

            sourceEditor.onDidLayoutChange(resizeEditor);
        });

        layout.registerComponent("stdin", function (container, state) {
            stdinEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                theme: "vs-dark",
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("stdout", function (container, state) {
            stdoutEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                theme: "vs-dark",
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                minimap: {
                    enabled: false
                }
            });

            container.on("tab", function(tab) {
                tab.element.append("<span id=\"stdout-dot\" class=\"dot\" hidden></span>");
                tab.element.on("mousedown", function(e) {
                    e.target.closest(".lm_tab").children[3].hidden = true;
                });
            });
        });

        layout.on("initialised", function () {
            $(".monaco-editor")[0].appendChild($("#editor-status-line")[0]);
            if (getIdFromURI()) {
                loadSavedSource();
            } else {
                loadRandomLanguage();
            }
            $("#site-navigation").css("border-bottom", "1px solid black");
            sourceEditor.focus();
            editorsUpdateFontSize(fontSize);
        });

        layout.init();
    });
});

// Template Sources
var bashSource = '\
echo "hello, world"\n\
';

var cSource =
  '\
#include <stdio.h>\n\
\n\
int main(void) {\n\
    printf("hello, world\\n");\n\
    return 0;\n\
}\n\
';

var cppSource =
  '\
#include <iostream>\n\
\n\
int main() {\n\
    std::cout << "hello, world" << std::endl;\n\
    return 0;\n\
}\n\
';

var goSource =
  '\
package main\n\
\n\
import "fmt"\n\
\n\
func main() {\n\
    fmt.Println("hello, world")\n\
}\n\
';

var tpm2toolsSource =
  '\
echo -e "Example: Get 20 random bytes from the TPM using tpm2-tools"\n\
tpm2_getrandom 20\n\
';

var tpm2tssSource =
  '\
#include <stdio.h>\n\
#include <tss2/tss2_mu.h>\n\
#include <tss2/tss2_esys.h>\n\
\n\
\n\
static void getRandom(int size) {\n\
    TSS2_RC r;\n\
\n\
    // Initialize the ESAPI context\n\
    ESYS_CONTEXT *ctx;\n\
    r = Esys_Initialize(&ctx, NULL, NULL);\n\
\n\
    if (r != TSS2_RC_SUCCESS){\n\
        printf("\\nError: Esys_Initialize\\n");\n\
        exit(1);\n\
    }\n\
\n\
    // Get random data\n\
    TPM2B_DIGEST *random_bytes;\n\
    r = Esys_GetRandom(ctx, ESYS_TR_NONE, ESYS_TR_NONE, ESYS_TR_NONE, size, &random_bytes);\n\
\n\
    if (r != TSS2_RC_SUCCESS){\n\
        printf("\\nError: Esys_GetRandom\\n");\n\
        exit(1);\n\
    }\n\
    for (int i = 0; i < random_bytes->size; i++) {\n\
        printf("0x%x ", random_bytes->buffer[i]);\n\
    }\n\
\n\
}\n\
\n\
int main() {\n\
    printf("Example: Get 20 random bytes from the TPM using tpm2-tss\\n");\n\
    getRandom(20);\n\
    return 0;\n\
}\n\
';

var ibmtssCmdLineSource =
  '\
echo -e "Example: Get 20 random bytes from the TPM using IBM TSS"\n\
tssgetrandom -by 20\n\
';

var ibmtssSource =
  '\
#include <stdio.h>\n\
#include <ibmtss/tss.h>\n\
\n\
static void getRandom(int size) {\n\
    TPM_RC rc = 0;\n\
    TSS_CONTEXT	*tssContext = NULL;\n\
    GetRandom_In in;\n\
    GetRandom_Out out;\n\
    TPMI_SH_AUTH_SESSION sessionHandle0 = TPM_RH_NULL;\n\
    unsigned int sessionAttributes0 = 0;\n\
    TPMI_SH_AUTH_SESSION sessionHandle1 = TPM_RH_NULL;\n\
    unsigned int sessionAttributes1 = 0;\n\
    TPMI_SH_AUTH_SESSION sessionHandle2 = TPM_RH_NULL;\n\
    unsigned int sessionAttributes2 = 0;\n\
\n\
    // Set the amount of requested bytes\n\
    in.bytesRequested = size;\n\
\n\
    // Create a tss context\n\
    rc = TSS_Create(&tssContext);\n\
\n\
    // Execute GetRandom command\n\
    rc = TSS_Execute(tssContext, (RESPONSE_PARAMETERS *)&out,\n\
        (COMMAND_PARAMETERS *)&in, NULL, TPM_CC_GetRandom, sessionHandle0, NULL,\n\
        sessionAttributes0, sessionHandle1, NULL, sessionAttributes1,\n\
        sessionHandle2, NULL, sessionAttributes2, TPM_RH_NULL, NULL, 0);\n\
\n\
    // Print the random bytes\n\
    TSS_PrintAll("randomBytes", out.randomBytes.t.buffer, size);\n\
\n\
}\n\
\n\
int main(void) {\n\
    printf("Example: Get 20 random bytes from the TPM using IBMTSS\\n");\n\
    getRandom(20);\n\
    return 0;\n\
}\n\
';

var goTpmToolsSource =
  '\
gotpm --help\n\
echo -e ""\n\
echo -e "Example: Get 20 random bytes from the TPM using gotpm from go-tpm-tools"\n\
gotpm read pcr --pcrs 0,1,2,3 --hash-algo sha256\n\
';

var goTpmSource =
  '\
// Gets 20 random bytes from the TPM at /dev/tpm0\n\
package main\n\
\n\
import (\n\
	"fmt"\n\
	"os"\n\
\n\
	"github.com/google/go-tpm/tpm2"\n\
)\n\
\n\
func getRandom(path string, bytes uint16) ([]byte, error) {\n\
	rwc, err := tpm2.OpenTPM(path)\n\
	if err != nil {\n\
		return nil, fmt.Errorf("can\'t open TPM at %q: %v", path, err)\n\
	}\n\
	defer rwc.Close()\n\
	return tpm2.GetRandom(rwc, bytes)\n\
}\n\
\n\
var (\n\
    tpmPath string = "/dev/tpm0"\n\
    bytes uint16 = 20\n\
)\n\
\n\
func main() {\n\
	val, err := getRandom(tpmPath, bytes)\n\
	if err != nil {\n\
		fmt.Fprintf(os.Stderr, "getting random bytes from TPM: %v\\n", err)\n\
		os.Exit(1)\n\
	}\n\
	fmt.Printf("Random bytes from the TPM:\\n%x\\n", val)\n\
}\n\
';

var wolfTPMCmdLineSource =
  '\
echo -n "Example: wrap_test script from wolfTPM"\n\
./wolfTPM/examples/wrap/wrap_test\n\
';

var wolfTPMSource =
  '\
#include <stdio.h>\n\
#include <wolftpm/tpm2.h>\n\
#include <wolftpm/tpm2_wrap.h>\n\
\n\
// Set TPM2_IoCb to NULL because we are using the TPM in /dev/tpm0\n\
#define TPM2_IoCb NULL\n\
\n\
static void wrapGetRandom(int size)\n\
{\n\
    int rc;\n\
    WOLFTPM2_DEV dev;\n\
    WOLFTPM2_BUFFER rngData;\n\
    rngData.size = size;\n\
\n\
    // Initialize TPM device\n\
    rc = wolfTPM2_Init(&dev, TPM2_IoCb, NULL);\n\
    // Get random bytes\n\
    rc = wolfTPM2_GetRandom(&dev, rngData.buffer, rngData.size);\n\
\n\
    // Print bytes\n\
    for (int i=0; i < rngData.size; ++i) {\n\
        printf("%x", rngData.buffer[i]);\n\
    }\n\
\n\
    // Cleanup\n\
    wolfTPM2_Cleanup(&dev);\n\
}\n\
\n\
static void nativeGetRandom(int size) {\n\
    int rc;\n\
    WOLFTPM2_DEV dev;\n\
    union {\n\
        GetRandom_In getRand;\n\
    } cmdIn;\n\
    union {\n\
        GetRandom_Out getRand;\n\
    } cmdOut;\n\
\n\
    XMEMSET(&cmdIn.getRand, 0, sizeof(cmdIn.getRand));\n\
\n\
    cmdIn.getRand.bytesRequested = size;\n\
\n\
    // Initialize TPM device\n\
    rc = wolfTPM2_Init(&dev, TPM2_IoCb, NULL);\n\
    // Get random bytes\n\
    rc = TPM2_GetRandom(&cmdIn.getRand, &cmdOut.getRand);\n\
\n\
    // Print bytes\n\
    for (int i=0; i < size; ++i) {\n\
        printf("%x", cmdOut.getRand.randomBytes.buffer[i]);\n\
    }\n\
\n\
    // Cleanup\n\
    wolfTPM2_Cleanup(&dev);\n\
\n\
}\n\
\n\
\n\
int main(void) {\n\
    printf("Example: Get 20 random bytes from the TPM using wolfTPM\'s wrap API\\n");\n\
    wrapGetRandom(20);\n\
    printf("\\n");\n\
    printf("Example: Get 20 random bytes from the TPM using wolfTPM\'s native API\\n");\n\
    nativeGetRandom(20);\n\
    return 0;\n\
}\n\
';

var pythonSource = 'print("hello, world")';

var sources = {
  46: bashSource,
  48: cSource,
  49: cSource,
  50: cSource,
  52: cppSource,
  53: cppSource,
  54: cppSource,
  60: goSource,
  70: pythonSource,
  71: pythonSource,
  75: cSource,
  76: cppSource,
  1001: cSource,
  1002: cppSource,
  2001: tpm2toolsSource, // tpm2-tools
  2002: tpm2tssSource, // tpm2-tss
  2003: ibmtssCmdLineSource, // ibmtss (bash)
  2004: ibmtssSource, // ibmtss (C)
  2005: goTpmToolsSource, // go-tpm-tools
  2006: goTpmSource, // go-tpm
  2008: wolfTPMCmdLineSource, // WolfTPM (bash)
  2009: wolfTPMSource, // WolfTPM (C)
};

var fileNames = {
  46: "script.sh",
  48: "main.c",
  49: "main.c",
  50: "main.c",
  52: "main.cpp",
  53: "main.cpp",
  54: "main.cpp",
  60: "main.go",
  70: "script.py",
  71: "script.py",
  75: "main.c",
  76: "main.cpp",
  1001: "main.c",
  1002: "main.cpp",
  2001: "script.sh", // tpm2-tools
  2002: "main.c", // tpm2-tss
  2003: "script.sh", // ibmtss (bash)
  2004: "main.c", // ibmtss (C)
  2005: "script.sh", // go-tpm-tools
  2006: "main.go", // go-tpm
  2008: "script.sh", // WolfTPM (bash)
  2009: "main.c", // WolfTPM (C)
};

var languageIdTable = {
  1001: 1,
  1002: 2,
  1003: 3,
  1004: 4,
  1005: 5,
  1006: 6,
  1007: 7,
  1008: 8,
  1009: 9,
  1010: 10,
  1011: 11,
  2001: 46, // tpm2-tools
  2002: 91, // tpm2-tss
  2003: 46, // ibmtss (bash)
  2004: 92, // ibmtss (C)
  2005: 46, // go-tpm-tools
  2006: 60, // go-tpm
  2008: 46, // WolfTPM (bash)
  2009: 90, // WolfTPM (C)
};