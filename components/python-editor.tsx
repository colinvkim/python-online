"use client";

import { memo, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "15px",
    backgroundColor: "#0f172a",
  },
  ".cm-content": {
    padding: "22px 0",
    caretColor: "#f8fafc",
  },
  ".cm-line": {
    padding: "0 22px",
  },
  ".cm-gutters": {
    backgroundColor: "#0f172a",
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
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        highlightActiveLineGutter: true,
        highlightSpecialChars: false,
      }}
      extensions={[
        python(),
        EditorView.lineWrapping,
        editorTheme,
        EditorView.theme({
          "&": {
            height: "100%",
          },
        }),
      ]}
      onChange={handleChange}
    />
  );
}

const PythonEditor = memo(PythonEditorComponent);

export default PythonEditor;
