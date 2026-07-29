// Monaco Editor Initialization and Management

let requestEditor = null;
let responseEditor = null;
let monacoLoaded = false;

function initMonacoEditors(theme = 'vs') {
  return new Promise((resolve, reject) => {
    if (window.monaco) {
      createEditors(theme);
      return resolve();
    }

    // Configure require object for Monaco CDN
    window.require = {
      paths: {
        'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
      }
    };

    const loaderScript = document.createElement('script');
    loaderScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
    loaderScript.onload = () => {
      window.require(['vs/editor/editor.main'], () => {
        monacoLoaded = true;
        createEditors(theme);
        resolve();
      });
    };
    loaderScript.onerror = (err) => reject(err);
    document.body.appendChild(loaderScript);
  });
}

function createEditors(theme) {
  defineCatppuccinThemes();
  const monacoTheme = theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte';
  const reqContainer = document.getElementById('request-monaco-container');
  const resContainer = document.getElementById('response-monaco-container');

  if (reqContainer && !requestEditor) {
    requestEditor = monaco.editor.create(reqContainer, {
      value: '// Select a request to view body',
      language: 'json',
      theme: monacoTheme,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'Fira Code', monospace"
    });
  }

  if (resContainer && !responseEditor) {
    responseEditor = monaco.editor.create(resContainer, {
      value: '// Select a request to view response',
      language: 'json',
      theme: monacoTheme,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'Fira Code', monospace"
    });
  }
}

function defineCatppuccinThemes() {
  if (!window.monaco) return;

  // Catppuccin Latte (Light)
  monaco.editor.defineTheme('catppuccin-latte', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'string',    foreground: '40a02b' }, // Latte Green
      { token: 'number',    foreground: 'fe640b' }, // Latte Peach
      { token: 'keyword',   foreground: '8839ef' }, // Latte Mauve
      { token: 'comment',   foreground: '8c8fa1', fontStyle: 'italic' }, // Latte Overlay1
      { token: 'type',      foreground: '1e66f5' }, // Latte Blue
      { token: 'delimiter', foreground: '7c7f93' }, // Latte Overlay0
      { token: 'key',       foreground: '1e66f5' }, // Latte Blue
    ],
    colors: {
      'editor.background':           '#eff1f5', // Latte Base
      'editor.foreground':           '#4c4f69', // Latte Text
      'editorLineNumber.foreground': '#8c8fa1', // Latte Overlay1
      'editorCursor.foreground':     '#dc8a78', // Latte Rosewater
      'editor.selectionBackground':  '#acb0be40', // Latte Surface2 translucent
      'editor.lineHighlightBackground': '#e6e9ef', // Latte Mantle
      'editorIndentGuide.background': '#ccd0da', // Latte Surface0
      'scrollbarSlider.background':  '#7c7f9366',
      'editorWidget.background':     '#e6e9ef', // Latte Mantle
      'input.background':            '#dce0e8', // Latte Crust
    }
  });

  // Catppuccin Mocha (Dark)
  monaco.editor.defineTheme('catppuccin-mocha', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string',    foreground: 'a6e3a1' }, // Mocha Green
      { token: 'number',    foreground: 'fab387' }, // Mocha Peach
      { token: 'keyword',   foreground: 'cba6f7' }, // Mocha Mauve
      { token: 'comment',   foreground: '7f849c', fontStyle: 'italic' }, // Mocha Overlay1
      { token: 'type',      foreground: '89b4fa' }, // Mocha Blue
      { token: 'delimiter', foreground: '9399b2' }, // Mocha Overlay2
      { token: 'key',       foreground: '89b4fa' }, // Mocha Blue
    ],
    colors: {
      'editor.background':           '#1e1e2e', // Mocha Base
      'editor.foreground':           '#cdd6f4', // Mocha Text
      'editorLineNumber.foreground': '#7f849c', // Mocha Overlay1
      'editorCursor.foreground':     '#f5e0dc', // Mocha Rosewater
      'editor.selectionBackground':  '#58596640', // Mocha Surface2 translucent
      'editor.lineHighlightBackground': '#181825', // Mocha Mantle
      'editorIndentGuide.background': '#313244', // Mocha Surface0
      'scrollbarSlider.background':  '#6c708666',
      'editorWidget.background':     '#181825', // Mocha Mantle
      'input.background':            '#11111b', // Mocha Crust
    }
  });
}

function setMonacoTheme(theme) {
  if (window.monaco) {
    defineCatppuccinThemes();
    const monacoTheme = theme === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte';
    monaco.editor.setTheme(monacoTheme);
  }
}

function detectLanguage(content, extension) {
  if (extension === 'json') return 'json';
  if (extension === 'xml') return 'xml';
  if (extension === 'html') return 'html';
  if (extension === 'js') return 'javascript';

  if (content && typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (trimmed.startsWith('<')) return 'xml';
  }
  return 'plaintext';
}

function formatXml(xmlStr) {
  let formatted = '';
  let reg = /(>)(<)(\/*)/g;
  xmlStr = xmlStr.replace(reg, '$1\r\n$2$3');
  let pad = 0;
  xmlStr.split('\r\n').forEach(function(node) {
    let indent = 0;
    if (node.match(/.+<\/\w[^>]*>$/)) {
      indent = 0;
    } else if (node.match(/^<\/\w/)) {
      if (pad !== 0) {
        pad -= 1;
      }
    } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
      indent = 1;
    } else {
      indent = 0;
    }

    let padding = '';
    for (let i = 0; i < pad; i++) {
      padding += '  ';
    }

    formatted += padding + node + '\r\n';
    pad += indent;
  });

  return formatted.trim();
}

function setRequestBodyContent(content, ext = 'txt') {
  if (!requestEditor) return;
  const lang = detectLanguage(content, ext);

  let formattedContent = content || '';
  if (lang === 'json' && content) {
    try {
      const parsed = JSON.parse(content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch (e) {
      formattedContent = content;
    }
  } else if (lang === 'xml' && content) {
    try {
      formattedContent = formatXml(content);
    } catch (e) {
      formattedContent = content;
    }
  }

  monaco.editor.setModelLanguage(requestEditor.getModel(), lang);
  requestEditor.setValue(formattedContent);
}

function setResponseBodyContent(content, ext = 'txt') {
  if (!responseEditor) return;
  const lang = detectLanguage(content, ext);

  let formattedContent = content || '';
  if (lang === 'json' && content) {
    try {
      const parsed = JSON.parse(content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch (e) {
      formattedContent = content;
    }
  } else if (lang === 'xml' && content) {
    try {
      formattedContent = formatXml(content);
    } catch (e) {
      formattedContent = content;
    }
  }

  monaco.editor.setModelLanguage(responseEditor.getModel(), lang);
  responseEditor.setValue(formattedContent);
}

window.monacoManager = {
  initMonacoEditors,
  setMonacoTheme,
  setRequestBodyContent,
  setResponseBodyContent,
  formatXml
};
