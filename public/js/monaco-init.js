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
  const reqContainer = document.getElementById('request-monaco-container');
  const resContainer = document.getElementById('response-monaco-container');

  if (reqContainer && !requestEditor) {
    requestEditor = monaco.editor.create(reqContainer, {
      value: '// Select a request to view body',
      language: 'json',
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
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
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'Fira Code', monospace"
    });
  }
}

function setMonacoTheme(theme) {
  if (window.monaco) {
    const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs';
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
