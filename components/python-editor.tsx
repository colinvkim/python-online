"use client";

import { memo, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, placeholder } from "@codemirror/view";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "16px",
    lineHeight: "1.65",
    backgroundColor: "#0b1422",
  },
  ".cm-content": {
    padding: "18px 0 24px",
    caretColor: "#f8fafc",
    tabSize: "2",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    minWidth: "40px",
    paddingRight: "4px",
    backgroundColor: "#0b1422",
    border: "none",
    color: "#64748b",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(56, 189, 248, 0.14)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(56, 189, 248, 0.24)",
  },
  ".cm-cursor": {
    borderLeftWidth: "2px",
  },
  ".cm-placeholder": {
    paddingLeft: "16px",
    color: "rgba(148, 163, 184, 0.56)",
  },
  ".cm-scroller": {
    overflow: "auto",
    overscrollBehavior: "contain",
    touchAction: "pan-x pan-y",
    WebkitOverflowScrolling: "touch",
  },
  ".cm-sizer": {
    minWidth: "100%",
    width: "fit-content",
  },
});

type PythonEditorProps = {
  initialCode: string;
  onCodeChange: (value: string) => void;
};

function PythonEditorComponent({
  initialCode,
  onCodeChange,
}: PythonEditorProps) {
  const [editorCode, setEditorCode] = useState(initialCode);

  useEffect(() => {
    setEditorCode(initialCode);
  }, [initialCode]);

  function handleChange(value: string) {
    setEditorCode(value);
    onCodeChange(value);
  }

  return (
    <CodeMirror
      value={editorCode}
      height="100%"
      theme={oneDark}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        highlightActiveLineGutter: true,
        highlightSpecialChars: false,
        bracketMatching: true,
        closeBrackets: false,
        indentOnInput: false,
        autocompletion: false,
        completionKeymap: false,
      }}
      extensions={[
        python(),
        editorTheme,
        placeholder("Type Python here, then press Run"),
        EditorView.contentAttributes.of({
          autocapitalize: "off",
          autocomplete: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
      ]}
      onChange={handleChange}
    />
  );
}

const PythonEditor = memo(PythonEditorComponent);

export default PythonEditor;
