define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var AMCTxtHighlightRules = function() {

    var options = "(?:" + `
 Title Presentation Code Lang Font
 BoxColor PaperSize
 AnswerSheetTitle AnswerSheetPresentation
 AnswerSheetColumns
 CompleteMulti SeparateAnswerSheet AutoMarks
 DefaultScoringM DefaultScoringS
 L-Question L-None L-Name L-Student
 LaTeX LaTeX-Preambule LaTeX-BeginDocument
 LaTeX-BeginCopy LaTeX-EndCopy
 PDF-BeginCopy PDF-EndCopy
 LaTeXEngine xltxtra
 ShuffleQuestions Columns QuestionBlocks
 Arabic ArabicFont
 Disable
 ManualDuplex SingleSided
 L-OpenText L-OpenReserved
 CodeDigitsDirection
 PackageOptions
 NameFieldWidth NameFieldLines NameFieldLinespace
 TitleWidth
 Pages
 RandomSeed
 PreAssociation PreAssociationKey PreAssociationName
 `.split(/\s+/).filter((s)=>s).join("|") + ")";
    // regexp must not have capturing parentheses. Use (?:) instead.
    // regexps are ordered -> the first match is used

    var anywhere = [
        { token: "comment",
          regex: /^\s*\#.*/,
        },
        { token: ["text", "parameter"],
          regex: "^(\\s*)(" + options + ":)",
          next:  "config",
        },
        { token: ["text", "parameter", "filename"],
          regex: /^(\s*)(IncludeFile:)(\s*)/,
          next:  "config",
        },
        { token: ["text", "parameter.unknown"],
          regex: /^(\s*)([a-zA-Z0-9-]+:)/,
          next:  "config",
        },
        { token: ["text", "declaration", "option"],
          regex: /^(\s*)(\*[\(\)])(\[[^\]]*\])?/,
          next: "group",
        },
        { token: ["text","declaration","angles","option","scoring","text"],
          regex: /^(\s*)(\*\*?)(<[^>]*>)?(\[[^\]]*\])?(\{[^\}]*\})?(\s*)/,
          next: "question",
        },
        { token: "keyword",
          regex: /\[verbatim\]/,
          next: "verbatim",
        },
        { token: "keyword",
          regex: /\[latex\]/,
          next: "latex",
        },
        { token: ["declaration", "option", "option.graphics", "filename", "declaration"],
          regex: /(!)(\{[^\}]*\})?(\[[^\]]*\])?([^\s!]+)(!)/,
        },
        { token: ["declaration", "latex", "declaration"],
          regex: /(\[\[)(.+?)(\]\])/,
        },
        { token: ["declaration", "markup.italic", "declaration"],
          regex: /(\[_)(.+?)(_\])/,
        },
        { token: ["declaration", "markup.bold", "declaration"],
          regex: /(\[\*)(.+?)(\*\])/,
        },
        { token: ["declaration", "markup.underline", "declaration"],
          regex: /(\[\/)(.+?)(\/\])/,
        },
        { token: ["declaration", "markup.raw", "declaration"],
          regex: /(\[\|)(.+?)(\|\])/,
        },
    ];

    var question = [
        { token: ["text", "declaration", "option", "scoring"],
          regex: /^(\s*)(-\s*)(\[[^\]]*\])?(\{[^\}]*\})?/,
          next: "answer.wrong",
        },
        { token: ["text", "declaration", "option", "scoring"],
          regex: /^(\s*)(\+\s*)(\[[^\]]*\])?(\{[^\}]*\})?/,
          next: "answer.correct",
        },
    ];
    
   this.$rules = {
       "start" : [
           ...anywhere,
           { defaultToken: "text" },
        ],
       "config" : [
           ...anywhere,
           { defaultToken : "text" }, 
       ],
       "question" : [
           ...question,
           ...anywhere,
           { defaultToken : "text" }, 
       ],
       "answer.wrong": [
           ...question,
           ...anywhere,
           { defaultToken: "answer.wrong" },
       ],
       "answer.correct": [
           ...question,
           ...anywhere,
           { defaultToken: "answer.correct" },
       ],
       "group": [
           ...anywhere,
           { defaultToken : "text" },
       ],
       "verbatim": [
           { token: "keyword",
             regex: /\[\/verbatim\]/,
             next: "start",
           },
           { defaultToken: "verbatim" },
       ],
       "latex": [
           { token: "keyword",
             regex: /\[\/latex\]/,
             next: "start",
           },
           { defaultToken: "latex" },
       ],
    };
};

oop.inherits(AMCTxtHighlightRules, TextHighlightRules);

exports.AMCTxtHighlightRules = AMCTxtHighlightRules;

});
