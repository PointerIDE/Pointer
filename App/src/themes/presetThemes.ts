import { ThemeSettings } from '../types';

export const presetThemes: Record<string, ThemeSettings> = {
  'VS Code Dark': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#1e1e1e',
      bgSecondary: '#252526',
      bgTertiary: '#2d2d30',
      bgSelected: '#264f78',
      bgHover: '#2a2d2e',
      bgAccent: '#0e639c',
      textPrimary: '#d4d4d4',
      textSecondary: '#858585',
      borderColor: '#3e3e42',
      borderPrimary: '#3e3e42',
      accentColor: '#0e639c',
      accentHover: '#1177bb',
      errorColor: '#f14c4c',
      titlebarBg: '#1e1e1e',
      statusbarBg: '#007acc',
      statusbarFg: '#ffffff',
      activityBarBg: '#333333',
      activityBarFg: '#ffffff',
      inlineCodeColor: '#cc0000',
      
      // Explorer colors
      explorerFolderFg: '#cccccc',
      explorerFolderExpandedFg: '#cccccc',
      explorerFileFg: '#cccccc',
      explorerFileJavaScriptFg: '#f1c40f',
      explorerFileTypeScriptFg: '#007acc',
      explorerFileJsonFg: '#f1c40f',
      explorerFileHtmlFg: '#e34c26',
      explorerFileCssFg: '#1572b6',
      explorerFileMarkdownFg: '#519aba',
      explorerFileYamlFg: '#cb171e',
      explorerFileImageFg: '#a074c4',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#f1c40f',
        'jsx': '#f1c40f',
        'ts': '#007acc',
        'tsx': '#007acc',
        'json': '#f1c40f',
        'html': '#e34c26',
        'htm': '#e34c26',
        'css': '#1572b6',
        'scss': '#1572b6',
        'less': '#1572b6',
        'md': '#519aba',
        'markdown': '#519aba',
        'yml': '#cb171e',
        'yaml': '#cb171e',
        'xml': '#e34c26',
        'svg': '#a074c4',
        'png': '#a074c4',
        'jpg': '#a074c4',
        'jpeg': '#a074c4',
        'gif': '#a074c4',
        'ico': '#a074c4',
        'py': '#3776ab',
        'java': '#ed8b00',
        'c': '#a8b9cc',
        'cpp': '#00599c',
        'h': '#a8b9cc',
        'hpp': '#00599c',
        'cs': '#239120',
        'php': '#777bb4',
        'rb': '#cc342d',
        'go': '#00add8',
        'rs': '#dea584',
        'swift': '#fa7343',
        'kt': '#7f52ff',
        'dart': '#0175c2',
        'vue': '#4fc08d',
        'svelte': '#ff3e00',
        'sh': '#89e051',
        'bash': '#89e051',
        'zsh': '#89e051',
        'fish': '#89e051',
        'ps1': '#012456',
        'bat': '#c1f12e',
        'cmd': '#c1f12e',
        'dockerfile': '#384d54',
        'docker': '#384d54',
        'gitignore': '#f1502f',
        'gitattributes': '#f1502f',
        'license': '#d0bf91',
        'readme': '#519aba',
        'changelog': '#87ceeb',
        'makefile': '#427819',
        'cmake': '#064f8c',
        'gradle': '#02303a',
        'maven': '#c71a36',
        'npm': '#cb3837',
        'yarn': '#2c8ebb',
        'package': '#cb3837',
        'lock': '#cb3837',
        'env': '#ecd53f',
        'config': '#6d8086',
        'ini': '#6d8086',
        'toml': '#9c4221',
        'properties': '#6d8086',
        'log': '#dddddd',
        'txt': '#dddddd',
        'pdf': '#ff0000',
        'doc': '#2b579a',
        'docx': '#2b579a',
        'xls': '#217346',
        'xlsx': '#217346',
        'ppt': '#d24726',
        'pptx': '#d24726',
        'zip': '#ffe066',
        'rar': '#ffe066',
        '7z': '#ffe066',
        'tar': '#ffe066',
        'gz': '#ffe066'
      }
    },
    editorColors: {
      'editor.background': '#1e1e1e',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editorCursor.foreground': '#d4d4d4',
      'editor.selectionBackground': '#264f78',
      'editor.lineHighlightBackground': '#2d2d2d50'
    },
    tokenColors: [
      {
        token: 'keyword',
        foreground: '#569CD6',
        fontStyle: 'bold'
      },
      {
        token: 'comment',
        foreground: '#6A9955',
        fontStyle: 'italic'
      },
      {
        token: 'string',
        foreground: '#CE9178'
      },
      {
        token: 'number',
        foreground: '#B5CEA8'
      },
      {
        token: 'operator',
        foreground: '#D4D4D4'
      },
      {
        token: 'type',
        foreground: '#4EC9B0'
      },
      {
        token: 'function',
        foreground: '#DCDCAA'
      },
      {
        token: 'variable',
        foreground: '#9CDCFE'
      }
    ]
  },
  'Ayu Dark': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#1a1a1a',
      bgSecondary: '#1f2430',
      bgTertiary: '#232834',
      bgSelected: '#2a2f3a',
      bgHover: '#2a2f3a',
      bgAccent: '#5ccfe6',
      textPrimary: '#b3b1ad',
      textSecondary: '#707a8c',
      borderColor: '#1f2430',
      borderPrimary: '#1f2430',
      accentColor: '#5ccfe6',
      accentHover: '#5ccfe6',
      errorColor: '#ff3333',
      titlebarBg: '#1a1a1a',
      statusbarBg: '#1a1a1a',
      statusbarFg: '#b3b1ad',
      activityBarBg: '#1a1a1a',
      activityBarFg: '#b3b1ad',
      inlineCodeColor: '#ffcc66',
      
      // Explorer colors
      explorerFolderFg: '#ffcc66',
      explorerFolderExpandedFg: '#ffcc66',
      explorerFileFg: '#b3b1ad',
      explorerFileJavaScriptFg: '#ffcc66',
      explorerFileTypeScriptFg: '#5ccfe6',
      explorerFileJsonFg: '#bae67e',
      explorerFileHtmlFg: '#ff9940',
      explorerFileCssFg: '#5ccfe6',
      explorerFileMarkdownFg: '#bae67e',
      explorerFileYamlFg: '#ffcc66',
      explorerFileImageFg: '#ff9940',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#ffcc66',
        'jsx': '#ffcc66',
        'ts': '#5ccfe6',
        'tsx': '#5ccfe6',
        'json': '#bae67e',
        'html': '#ff9940',
        'htm': '#ff9940',
        'css': '#5ccfe6',
        'scss': '#5ccfe6',
        'less': '#5ccfe6',
        'md': '#bae67e',
        'markdown': '#bae67e',
        'yml': '#ffcc66',
        'yaml': '#ffcc66',
        'png': '#ff9940',
        'jpg': '#ff9940',
        'jpeg': '#ff9940',
        'gif': '#ff9940',
        'svg': '#ff9940',
        'webp': '#ff9940',
      },
    },
    editorColors: {
      "editor.background": "#1f2430",
      "editor.foreground": "#b3b1ad",
      "editorLineNumber.foreground": "#707a8c",
      "editorLineNumber.activeForeground": "#b3b1ad",
      "editorCursor.foreground": "#ffcc66",
      "editor.selectionBackground": "#2a2f3a",
      "editor.lineHighlightBackground": "#2a2f3a50",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#ffcc66', fontStyle: 'bold' },
      { token: 'comment', foreground: '#5c6770', fontStyle: 'italic' },
      { token: 'string', foreground: '#bae67e' },
      { token: 'number', foreground: '#ffcc66' },
      { token: 'operator', foreground: '#ffcc66' },
      { token: 'type', foreground: '#5ccfe6' },
      { token: 'function', foreground: '#ffd700' },
      { token: 'variable', foreground: '#b3b1ad' }
    ]
  },
  'Atom Dark': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#282c34',
      bgSecondary: '#21252b',
      bgTertiary: '#1a1d23',
      bgSelected: '#2c313c',
      bgHover: '#2c313c',
      bgAccent: '#61afef',
      textPrimary: '#abb2bf',
      textSecondary: '#5c6370',
      borderColor: '#21252b',
      borderPrimary: '#21252b',
      accentColor: '#61afef',
      accentHover: '#61afef',
      errorColor: '#e06c75',
      titlebarBg: '#282c34',
      statusbarBg: '#282c34',
      statusbarFg: '#abb2bf',
      activityBarBg: '#282c34',
      activityBarFg: '#abb2bf',
      inlineCodeColor: '#e06c75',
      
      // Explorer colors
      explorerFolderFg: '#e5c07b',
      explorerFolderExpandedFg: '#e5c07b',
      explorerFileFg: '#abb2bf',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#98c379',
        'jsx': '#98c379',
        'ts': '#61afef',
        'tsx': '#61afef',
        'json': '#d19a66',
        'html': '#e06c75',
        'htm': '#e06c75',
        'css': '#56b6c2',
        'scss': '#56b6c2',
        'less': '#56b6c2',
        'md': '#98c379',
        'markdown': '#98c379',
        'yml': '#d19a66',
        'yaml': '#d19a66',
        'png': '#c678dd',
        'jpg': '#c678dd',
        'jpeg': '#c678dd',
        'gif': '#c678dd',
        'svg': '#c678dd',
        'webp': '#c678dd',
      },
    },
    editorColors: {
      "editor.background": "#282c34",
      "editor.foreground": "#abb2bf",
      "editorLineNumber.foreground": "#495162",
      "editorLineNumber.activeForeground": "#abb2bf",
      "editorCursor.foreground": "#528bff",
      "editor.selectionBackground": "#3e4451",
      "editor.lineHighlightBackground": "#2c313c50",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#c678dd', fontStyle: 'bold' },
      { token: 'comment', foreground: '#5c6370', fontStyle: 'italic' },
      { token: 'string', foreground: '#98c379' },
      { token: 'number', foreground: '#d19a66' },
      { token: 'operator', foreground: '#56b6c2' },
      { token: 'type', foreground: '#e5c07b' },
      { token: 'function', foreground: '#61afef' },
      { token: 'variable', foreground: '#e06c75' }
    ]
  },
  'Night Owl': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#011627',
      bgSecondary: '#0c2133',
      bgTertiary: '#0d2438',
      bgSelected: '#1d3b53',
      bgHover: '#1d3b53',
      bgAccent: '#7fdbca',
      textPrimary: '#d6deeb',
      textSecondary: '#637777',
      borderColor: '#0c2133',
      borderPrimary: '#0c2133',
      accentColor: '#7fdbca',
      accentHover: '#7fdbca',
      errorColor: '#ff7b72',
      titlebarBg: '#011627',
      statusbarBg: '#011627',
      statusbarFg: '#d6deeb',
      activityBarBg: '#011627',
      activityBarFg: '#d6deeb',
      inlineCodeColor: '#ff7b72',
      
      // Explorer colors
      explorerFolderFg: '#82aaff',
      explorerFolderExpandedFg: '#82aaff',
      explorerFileFg: '#d6deeb',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#82aaff',
        'jsx': '#82aaff', 
        'ts': '#82aaff',
        'tsx': '#82aaff',
        'json': '#ecc48d',
        'html': '#ff7b72',
        'htm': '#ff7b72',
        'css': '#7fdbca',
        'scss': '#7fdbca',
        'less': '#7fdbca',
        'md': '#7fdbca',
        'markdown': '#7fdbca',
        'yml': '#ecc48d',
        'yaml': '#ecc48d',
        'png': '#c792ea',
        'jpg': '#c792ea',
        'jpeg': '#c792ea',
        'gif': '#c792ea',
        'svg': '#c792ea',
        'webp': '#c792ea',
      },
    },
    editorColors: {
      "editor.background": "#011627",
      "editor.foreground": "#d6deeb",
      "editorLineNumber.foreground": "#637777",
      "editorLineNumber.activeForeground": "#d6deeb",
      "editorCursor.foreground": "#7fdbca",
      "editor.selectionBackground": "#1d3b53",
      "editor.lineHighlightBackground": "#1d3b5350",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#c792ea', fontStyle: 'bold' },
      { token: 'comment', foreground: '#637777', fontStyle: 'italic' },
      { token: 'string', foreground: '#ecc48d' },
      { token: 'number', foreground: '#f78c6c' },
      { token: 'operator', foreground: '#7fdbca' },
      { token: 'type', foreground: '#82aaff' },
      { token: 'function', foreground: '#82aaff' },
      { token: 'variable', foreground: '#ff7b72' }
    ]
  },
  'Dracula': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#282a36',
      bgSecondary: '#44475a',
      bgTertiary: '#44475a',
      bgSelected: '#44475a',
      bgHover: '#44475a',
      bgAccent: '#bd93f9',
      textPrimary: '#f8f8f2',
      textSecondary: '#6272a4',
      borderColor: '#44475a',
      borderPrimary: '#44475a',
      accentColor: '#bd93f9',
      accentHover: '#bd93f9',
      errorColor: '#ff5555',
      titlebarBg: '#282a36',
      statusbarBg: '#282a36',
      statusbarFg: '#f8f8f2',
      activityBarBg: '#282a36',
      activityBarFg: '#f8f8f2',
      inlineCodeColor: '#ff79c6',
      
      // Explorer colors
      explorerFolderFg: '#bd93f9',
      explorerFolderExpandedFg: '#ff79c6',
      explorerFileFg: '#f8f8f2',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#f1fa8c',
        'jsx': '#f1fa8c',
        'ts': '#8be9fd',
        'tsx': '#8be9fd',
        'json': '#bd93f9',
        'html': '#ff79c6',
        'htm': '#ff79c6',
        'css': '#ff79c6',
        'scss': '#ff79c6',
        'less': '#ff79c6',
        'md': '#50fa7b',
        'markdown': '#50fa7b',
        'yml': '#f1fa8c',
        'yaml': '#f1fa8c',
        'png': '#bd93f9',
        'jpg': '#bd93f9',
        'jpeg': '#bd93f9',
        'gif': '#bd93f9',
        'svg': '#bd93f9',
        'webp': '#bd93f9',
      },
    },
    editorColors: {
      "editor.background": "#282a36",
      "editor.foreground": "#f8f8f2",
      "editorLineNumber.foreground": "#6272a4",
      "editorLineNumber.activeForeground": "#f8f8f2",
      "editorCursor.foreground": "#f8f8f2",
      "editor.selectionBackground": "#44475a",
      "editor.lineHighlightBackground": "#44475a50",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#ff79c6', fontStyle: 'bold' },
      { token: 'comment', foreground: '#6272a4', fontStyle: 'italic' },
      { token: 'string', foreground: '#f1fa8c' },
      { token: 'number', foreground: '#bd93f9' },
      { token: 'operator', foreground: '#ff79c6' },
      { token: 'type', foreground: '#8be9fd' },
      { token: 'function', foreground: '#50fa7b' },
      { token: 'variable', foreground: '#f8f8f2' }
    ]
  },
  'One Dark Pro': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#282c34',
      bgSecondary: '#21252b',
      bgTertiary: '#1a1d23',
      bgSelected: '#2c313c',
      bgHover: '#2c313c',
      bgAccent: '#61afef',
      textPrimary: '#abb2bf',
      textSecondary: '#5c6370',
      borderColor: '#21252b',
      borderPrimary: '#21252b',
      accentColor: '#61afef',
      accentHover: '#61afef',
      errorColor: '#e06c75',
      titlebarBg: '#282c34',
      statusbarBg: '#282c34',
      statusbarFg: '#abb2bf',
      activityBarBg: '#282c34',
      activityBarFg: '#abb2bf',
      inlineCodeColor: '#e06c75',
      
      // Explorer colors
      explorerFolderFg: '#e5c07b',
      explorerFolderExpandedFg: '#e5c07b',
      explorerFileFg: '#abb2bf',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#98c379',
        'jsx': '#98c379',
        'ts': '#61afef',
        'tsx': '#61afef',
        'json': '#d19a66',
        'html': '#e06c75',
        'htm': '#e06c75',
        'css': '#56b6c2',
        'scss': '#56b6c2',
        'less': '#56b6c2',
        'md': '#98c379',
        'markdown': '#98c379',
        'yml': '#d19a66',
        'yaml': '#d19a66',
        'png': '#c678dd',
        'jpg': '#c678dd',
        'jpeg': '#c678dd',
        'gif': '#c678dd',
        'svg': '#c678dd',
        'webp': '#c678dd',
      },
    },
    editorColors: {
      "editor.background": "#282c34",
      "editor.foreground": "#abb2bf",
      "editorLineNumber.foreground": "#495162",
      "editorLineNumber.activeForeground": "#abb2bf",
      "editorCursor.foreground": "#528bff",
      "editor.selectionBackground": "#3e4451",
      "editor.lineHighlightBackground": "#2c313c50",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#c678dd', fontStyle: 'bold' },
      { token: 'comment', foreground: '#5c6370', fontStyle: 'italic' },
      { token: 'string', foreground: '#98c379' },
      { token: 'number', foreground: '#d19a66' },
      { token: 'operator', foreground: '#56b6c2' },
      { token: 'type', foreground: '#e5c07b' },
      { token: 'function', foreground: '#61afef' },
      { token: 'variable', foreground: '#e06c75' }
    ]
  },
  'Material Dark': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#263238',
      bgSecondary: '#1e272c',
      bgTertiary: '#1e272c',
      bgSelected: '#37474f',
      bgHover: '#37474f',
      bgAccent: '#80cbc4',
      textPrimary: '#eeffff',
      textSecondary: '#546e7a',
      borderColor: '#1e272c',
      borderPrimary: '#1e272c',
      accentColor: '#80cbc4',
      accentHover: '#80cbc4',
      errorColor: '#ff5370',
      titlebarBg: '#263238',
      statusbarBg: '#263238',
      statusbarFg: '#eeffff',
      activityBarBg: '#263238',
      activityBarFg: '#eeffff',
      inlineCodeColor: '#ff5370',
      
      // Explorer colors
      explorerFolderFg: '#82aaff',
      explorerFolderExpandedFg: '#82aaff',
      explorerFileFg: '#eeffff',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#c3e88d',
        'jsx': '#c3e88d',
        'ts': '#82aaff',
        'tsx': '#82aaff',
        'json': '#f78c6c',
        'html': '#ff5370',
        'htm': '#ff5370',
        'css': '#89ddff',
        'scss': '#89ddff',
        'less': '#89ddff',
        'md': '#c3e88d',
        'markdown': '#c3e88d',
        'yml': '#f78c6c',
        'yaml': '#f78c6c',
        'png': '#c792ea',
        'jpg': '#c792ea',
        'jpeg': '#c792ea',
        'gif': '#c792ea',
        'svg': '#c792ea',
        'webp': '#c792ea',
      },
    },
    editorColors: {
      "editor.background": "#263238",
      "editor.foreground": "#eeffff",
      "editorLineNumber.foreground": "#546e7a",
      "editorLineNumber.activeForeground": "#eeffff",
      "editorCursor.foreground": "#80cbc4",
      "editor.selectionBackground": "#37474f",
      "editor.lineHighlightBackground": "#37474f50",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#c792ea', fontStyle: 'bold' },
      { token: 'comment', foreground: '#546e7a', fontStyle: 'italic' },
      { token: 'string', foreground: '#c3e88d' },
      { token: 'number', foreground: '#f78c6c' },
      { token: 'operator', foreground: '#89ddff' },
      { token: 'type', foreground: '#89ddff' },
      { token: 'function', foreground: '#82aaff' },
      { token: 'variable', foreground: '#ff5370' }
    ]
  },
  'GitHub Light': {
    name: 'vs',
    customColors: {
      bgPrimary: '#ffffff',
      bgSecondary: '#f5f7f9',
      bgTertiary: '#eef1f5',
      bgSelected: '#e2e5e9',
      bgHover: '#f0f3f6',
      bgAccent: '#0969da',
      textPrimary: '#24292f',
      textSecondary: '#57606a',
      borderColor: '#d0d7de',
      borderPrimary: '#d0d7de',
      accentColor: '#0969da',
      accentHover: '#0860C5',
      errorColor: '#cf222e',
      titlebarBg: '#ffffff',
      statusbarBg: '#ffffff',
      statusbarFg: '#24292f',
      activityBarBg: '#f5f7f9',
      activityBarFg: '#24292f',
      inlineCodeColor: '#d73a49',
      
      // Explorer colors
      explorerFolderFg: '#0969da',
      explorerFolderExpandedFg: '#0969da',
      explorerFileFg: '#24292f',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#0550ae',
        'jsx': '#0550ae',
        'ts': '#0550ae',
        'tsx': '#0550ae',
        'json': '#953800',
        'html': '#cf222e',
        'htm': '#cf222e',
        'css': '#0550ae',
        'scss': '#0550ae',
        'less': '#0550ae',
        'md': '#0a3069',
        'markdown': '#0a3069',
        'yml': '#953800',
        'yaml': '#953800',
        'png': '#8250df',
        'jpg': '#8250df',
        'jpeg': '#8250df',
        'gif': '#8250df',
        'svg': '#8250df',
        'webp': '#8250df',
      },
    },
    editorColors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#24292f",
      "editorLineNumber.foreground": "#6e7781",
      "editorLineNumber.activeForeground": "#24292f",
      "editorCursor.foreground": "#0969da",
      "editor.selectionBackground": "#d0d7de60",
      "editor.lineHighlightBackground": "#f6f8fa",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#cf222e', fontStyle: 'bold' },
      { token: 'comment', foreground: '#6e7781', fontStyle: 'italic' },
      { token: 'string', foreground: '#0a3069' },
      { token: 'number', foreground: '#0550ae' },
      { token: 'operator', foreground: '#24292f' },
      { token: 'type', foreground: '#953800' },
      { token: 'function', foreground: '#8250df' },
      { token: 'variable', foreground: '#24292f' }
    ]
  },
  'Solarized Light': {
    name: 'vs',
    customColors: {
      bgPrimary: '#fdf6e3',
      bgSecondary: '#eee8d5',
      bgTertiary: '#e4decd',
      bgSelected: '#d9d2c2',
      bgHover: '#e4decd',
      bgAccent: '#268bd2',
      textPrimary: '#657b83',
      textSecondary: '#93a1a1',
      borderColor: '#e4decd',
      borderPrimary: '#e4decd',
      accentColor: '#268bd2',
      accentHover: '#2075b0',
      errorColor: '#dc322f',
      titlebarBg: '#eee8d5',
      statusbarBg: '#eee8d5',
      statusbarFg: '#657b83',
      activityBarBg: '#eee8d5',
      activityBarFg: '#657b83',
      inlineCodeColor: '#dc322f',
      
      // Explorer colors
      explorerFolderFg: '#268bd2',
      explorerFolderExpandedFg: '#268bd2',
      explorerFileFg: '#657b83',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#2aa198',
        'jsx': '#2aa198',
        'ts': '#268bd2',
        'tsx': '#268bd2',
        'json': '#d33682',
        'html': '#dc322f',
        'htm': '#dc322f',
        'css': '#6c71c4',
        'scss': '#6c71c4',
        'less': '#6c71c4',
        'md': '#859900',
        'markdown': '#859900',
        'yml': '#b58900',
        'yaml': '#b58900',
        'png': '#cb4b16',
        'jpg': '#cb4b16',
        'jpeg': '#cb4b16',
        'gif': '#cb4b16',
        'svg': '#cb4b16',
        'webp': '#cb4b16',
      },
    },
    editorColors: {
      "editor.background": "#fdf6e3",
      "editor.foreground": "#657b83",
      "editorLineNumber.foreground": "#93a1a1",
      "editorLineNumber.activeForeground": "#586e75",
      "editorCursor.foreground": "#268bd2",
      "editor.selectionBackground": "#eee8d580",
      "editor.lineHighlightBackground": "#eee8d550",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#859900', fontStyle: 'bold' },
      { token: 'comment', foreground: '#93a1a1', fontStyle: 'italic' },
      { token: 'string', foreground: '#2aa198' },
      { token: 'number', foreground: '#d33682' },
      { token: 'operator', foreground: '#657b83' },
      { token: 'type', foreground: '#b58900' },
      { token: 'function', foreground: '#268bd2' },
      { token: 'variable', foreground: '#cb4b16' }
    ]
  },
  'Ayu Light': {
    name: 'vs',
    customColors: {
      bgPrimary: '#fafafa',
      bgSecondary: '#f3f3f3',
      bgTertiary: '#e8e8e8',
      bgSelected: '#dcdcdc',
      bgHover: '#e8e8e8',
      bgAccent: '#55b4d4',
      textPrimary: '#5c6166',
      textSecondary: '#828c99',
      borderColor: '#e8e8e8',
      borderPrimary: '#e8e8e8',
      accentColor: '#55b4d4',
      accentHover: '#329dc1',
      errorColor: '#f07171',
      titlebarBg: '#fafafa',
      statusbarBg: '#fafafa',
      statusbarFg: '#5c6166',
      activityBarBg: '#f3f3f3',
      activityBarFg: '#5c6166',
      inlineCodeColor: '#f07171',
      
      // Explorer colors
      explorerFolderFg: '#f2ae49',
      explorerFolderExpandedFg: '#f2ae49',
      explorerFileFg: '#5c6166',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#86b300',
        'jsx': '#86b300',
        'ts': '#55b4d4',
        'tsx': '#55b4d4',
        'json': '#a37acc',
        'html': '#f07171',
        'htm': '#f07171',
        'css': '#fa8d3e',
        'scss': '#fa8d3e',
        'less': '#fa8d3e',
        'md': '#86b300',
        'markdown': '#86b300',
        'yml': '#f2ae49',
        'yaml': '#f2ae49',
        'png': '#a37acc',
        'jpg': '#a37acc',
        'jpeg': '#a37acc',
        'gif': '#a37acc',
        'svg': '#a37acc',
        'webp': '#a37acc',
      },
    },
    editorColors: {
      "editor.background": "#fafafa",
      "editor.foreground": "#5c6166",
      "editorLineNumber.foreground": "#828c99",
      "editorLineNumber.activeForeground": "#5c6166",
      "editorCursor.foreground": "#55b4d4",
      "editor.selectionBackground": "#e8e8e8",
      "editor.lineHighlightBackground": "#f3f3f380",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#fa8d3e', fontStyle: 'bold' },
      { token: 'comment', foreground: '#abb0b6', fontStyle: 'italic' },
      { token: 'string', foreground: '#86b300' },
      { token: 'number', foreground: '#a37acc' },
      { token: 'operator', foreground: '#ed9366' },
      { token: 'type', foreground: '#55b4d4' },
      { token: 'function', foreground: '#f2ae49' },
      { token: 'variable', foreground: '#5c6166' }
    ]
  },
  'Tokyo Night': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#1a1b26',
      bgSecondary: '#16161e',
      bgTertiary: '#1a1b26',
      bgSelected: '#2f3549',
      bgHover: '#2e3c64',
      bgAccent: '#7aa2f7',
      textPrimary: '#a9b1d6',
      textSecondary: '#565f89',
      borderColor: '#16161e',
      borderPrimary: '#16161e',
      accentColor: '#7aa2f7',
      accentHover: '#7aa2f7',
      errorColor: '#f7768e',
      titlebarBg: '#16161e',
      statusbarBg: '#16161e',
      statusbarFg: '#a9b1d6',
      activityBarBg: '#16161e',
      activityBarFg: '#a9b1d6',
      inlineCodeColor: '#bb9af7',
      
      // Explorer colors
      explorerFolderFg: '#7aa2f7',
      explorerFolderExpandedFg: '#7aa2f7',
      explorerFileFg: '#a9b1d6',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#9ece6a',
        'jsx': '#9ece6a',
        'ts': '#7aa2f7',
        'tsx': '#7aa2f7',
        'json': '#ff9e64',
        'html': '#f7768e',
        'htm': '#f7768e',
        'css': '#2ac3de',
        'scss': '#2ac3de',
        'less': '#2ac3de',
        'md': '#9ece6a',
        'markdown': '#9ece6a',
        'yml': '#ff9e64',
        'yaml': '#ff9e64',
        'png': '#bb9af7',
        'jpg': '#bb9af7',
        'jpeg': '#bb9af7',
        'gif': '#bb9af7',
        'svg': '#bb9af7',
        'webp': '#bb9af7',
      },
    },
    editorColors: {
      "editor.background": "#1a1b26",
      "editor.foreground": "#a9b1d6",
      "editorLineNumber.foreground": "#565f89",
      "editorLineNumber.activeForeground": "#a9b1d6",
      "editorCursor.foreground": "#7aa2f7",
      "editor.selectionBackground": "#2e3c64",
      "editor.lineHighlightBackground": "#1e202e",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#bb9af7', fontStyle: 'bold' },
      { token: 'comment', foreground: '#565f89', fontStyle: 'italic' },
      { token: 'string', foreground: '#9ece6a' },
      { token: 'number', foreground: '#ff9e64' },
      { token: 'operator', foreground: '#89ddff' },
      { token: 'type', foreground: '#2ac3de' },
      { token: 'function', foreground: '#7aa2f7' },
      { token: 'variable', foreground: '#c0caf5' }
    ]
  },
  'Nord': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#2e3440',
      bgSecondary: '#272c36',
      bgTertiary: '#3b4252',
      bgSelected: '#434c5e',
      bgHover: '#3b4252',
      bgAccent: '#88c0d0',
      textPrimary: '#d8dee9',
      textSecondary: '#81a1c1',
      borderColor: '#3b4252',
      borderPrimary: '#3b4252',
      accentColor: '#88c0d0',
      accentHover: '#88c0d0',
      errorColor: '#bf616a',
      titlebarBg: '#2e3440',
      statusbarBg: '#2e3440',
      statusbarFg: '#d8dee9',
      activityBarBg: '#2e3440',
      activityBarFg: '#d8dee9',
      inlineCodeColor: '#5e81ac',
      
      // Explorer colors
      explorerFolderFg: '#88c0d0',
      explorerFolderExpandedFg: '#88c0d0',
      explorerFileFg: '#d8dee9',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#a3be8c',
        'jsx': '#a3be8c',
        'ts': '#88c0d0',
        'tsx': '#88c0d0',
        'json': '#b48ead',
        'html': '#bf616a',
        'htm': '#bf616a',
        'css': '#81a1c1',
        'scss': '#81a1c1',
        'less': '#81a1c1',
        'md': '#a3be8c',
        'markdown': '#a3be8c',
        'yml': '#ebcb8b',
        'yaml': '#ebcb8b',
        'png': '#b48ead',
        'jpg': '#b48ead',
        'jpeg': '#b48ead',
        'gif': '#b48ead',
        'svg': '#b48ead',
        'webp': '#b48ead',
      },
    },
    editorColors: {
      "editor.background": "#2e3440",
      "editor.foreground": "#d8dee9",
      "editorLineNumber.foreground": "#4c566a",
      "editorLineNumber.activeForeground": "#d8dee9",
      "editorCursor.foreground": "#d8dee9",
      "editor.selectionBackground": "#434c5e",
      "editor.lineHighlightBackground": "#3b425277",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#81a1c1', fontStyle: 'bold' },
      { token: 'comment', foreground: '#4c566a', fontStyle: 'italic' },
      { token: 'string', foreground: '#a3be8c' },
      { token: 'number', foreground: '#b48ead' },
      { token: 'operator', foreground: '#81a1c1' },
      { token: 'type', foreground: '#8fbcbb' },
      { token: 'function', foreground: '#88c0d0' },
      { token: 'variable', foreground: '#d8dee9' }
    ]
  },
  'Moonlight': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#212337',
      bgSecondary: '#191a2a',
      bgTertiary: '#222436',
      bgSelected: '#2f334d',
      bgHover: '#2f334d',
      bgAccent: '#82aaff',
      textPrimary: '#c8d3f5',
      textSecondary: '#7a88cf',
      borderColor: '#222436',
      borderPrimary: '#222436',
      accentColor: '#82aaff',
      accentHover: '#82aaff',
      errorColor: '#ff757f',
      titlebarBg: '#191a2a',
      statusbarBg: '#191a2a',
      statusbarFg: '#c8d3f5',
      activityBarBg: '#191a2a',
      activityBarFg: '#c8d3f5',
      inlineCodeColor: '#c099ff',
      
      // Explorer colors
      explorerFolderFg: '#65bcff',
      explorerFolderExpandedFg: '#65bcff',
      explorerFileFg: '#c8d3f5',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#c3e88d',
        'jsx': '#c3e88d',
        'ts': '#82aaff',
        'tsx': '#82aaff',
        'json': '#ff966c',
        'html': '#ff757f',
        'htm': '#ff757f',
        'css': '#89ddff',
        'scss': '#89ddff',
        'less': '#89ddff',
        'md': '#c3e88d',
        'markdown': '#c3e88d',
        'yml': '#ffc777',
        'yaml': '#ffc777',
        'png': '#c099ff',
        'jpg': '#c099ff',
        'jpeg': '#c099ff',
        'gif': '#c099ff',
        'svg': '#c099ff',
        'webp': '#c099ff',
      },
    },
    editorColors: {
      "editor.background": "#212337",
      "editor.foreground": "#c8d3f5",
      "editorLineNumber.foreground": "#444a73",
      "editorLineNumber.activeForeground": "#c8d3f5",
      "editorCursor.foreground": "#82aaff",
      "editor.selectionBackground": "#444a73",
      "editor.lineHighlightBackground": "#2f334d",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#fca7ea', fontStyle: 'bold' },
      { token: 'comment', foreground: '#7a88cf', fontStyle: 'italic' },
      { token: 'string', foreground: '#c3e88d' },
      { token: 'number', foreground: '#ff966c' },
      { token: 'operator', foreground: '#89ddff' },
      { token: 'type', foreground: '#65bcff' },
      { token: 'function', foreground: '#82aaff' },
      { token: 'variable', foreground: '#c8d3f5' }
    ]
  },
  'Synthwave \'84': {
    name: 'vs-dark',
    customColors: {
      bgPrimary: '#241b2f',
      bgSecondary: '#2a2139',
      bgTertiary: '#34294f',
      bgSelected: '#453976',
      bgHover: '#4c3f78',
      bgAccent: '#ff7edb',
      textPrimary: '#f8f8f2',
      textSecondary: '#b6b1cb',
      borderColor: '#34294f',
      borderPrimary: '#34294f',
      accentColor: '#ff7edb',
      accentHover: '#ff7edb',
      errorColor: '#fe4450',
      titlebarBg: '#241b2f',
      statusbarBg: '#241b2f',
      statusbarFg: '#f8f8f2',
      activityBarBg: '#241b2f',
      activityBarFg: '#f8f8f2',
      inlineCodeColor: '#fe4450',
      
      // Explorer colors
      explorerFolderFg: '#f97e72',
      explorerFolderExpandedFg: '#ff7edb',
      explorerFileFg: '#f8f8f2',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#fede5d',
        'jsx': '#fede5d',
        'ts': '#36f9f6',
        'tsx': '#36f9f6',
        'json': '#f97e72',
        'html': '#fe4450',
        'htm': '#fe4450',
        'css': '#36f9f6',
        'scss': '#36f9f6',
        'less': '#36f9f6',
        'md': '#72f1b8',
        'markdown': '#72f1b8',
        'yml': '#fede5d',
        'yaml': '#fede5d',
        'png': '#ff7edb',
        'jpg': '#ff7edb',
        'jpeg': '#ff7edb',
        'gif': '#ff7edb',
        'svg': '#ff7edb',
        'webp': '#ff7edb',
      },
    },
    editorColors: {
      "editor.background": "#262335",
      "editor.foreground": "#f8f8f2",
      "editorLineNumber.foreground": "#848bbd",
      "editorLineNumber.activeForeground": "#f8f8f2",
      "editorCursor.foreground": "#f92aad",
      "editor.selectionBackground": "#453976",
      "editor.lineHighlightBackground": "#453976",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#f92aad', fontStyle: 'bold' },
      { token: 'comment', foreground: '#848bbd', fontStyle: 'italic' },
      { token: 'string', foreground: '#fede5d' },
      { token: 'number', foreground: '#f97e72' },
      { token: 'operator', foreground: '#36f9f6' },
      { token: 'type', foreground: '#ff7edb' },
      { token: 'function', foreground: '#36f9f6' },
      { token: 'variable', foreground: '#f8f8f2' }
    ]
  },
  'Monochrome Light': {
    name: 'vs',
    customColors: {
      bgPrimary: '#ffffff',
      bgSecondary: '#f5f5f5',
      bgTertiary: '#ebebeb',
      bgSelected: '#e0e0e0',
      bgHover: '#ebebeb',
      bgAccent: '#1e1e1e',
      textPrimary: '#1e1e1e',
      textSecondary: '#6e6e6e',
      borderColor: '#e0e0e0',
      borderPrimary: '#e0e0e0',
      accentColor: '#1e1e1e',
      accentHover: '#3e3e3e',
      errorColor: '#d32f2f',
      titlebarBg: '#f5f5f5',
      statusbarBg: '#f5f5f5',
      statusbarFg: '#1e1e1e',
      activityBarBg: '#f5f5f5',
      activityBarFg: '#1e1e1e',
      inlineCodeColor: '#d32f2f',
      
      // Explorer colors
      explorerFolderFg: '#3e3e3e',
      explorerFolderExpandedFg: '#1e1e1e',
      explorerFileFg: '#1e1e1e',
      
      // Custom file extensions
      customFileExtensions: {
        'js': '#4e4e4e',
        'jsx': '#4e4e4e',
        'ts': '#3e3e3e',
        'tsx': '#3e3e3e',
        'json': '#4e4e4e',
        'html': '#3e3e3e',
        'htm': '#3e3e3e',
        'css': '#4e4e4e',
        'scss': '#4e4e4e',
        'less': '#4e4e4e',
        'md': '#3e3e3e',
        'markdown': '#3e3e3e',
        'yml': '#4e4e4e',
        'yaml': '#4e4e4e',
        'png': '#3e3e3e',
        'jpg': '#3e3e3e',
        'jpeg': '#3e3e3e',
        'gif': '#3e3e3e',
        'svg': '#3e3e3e',
        'webp': '#3e3e3e',
      },
    },
    editorColors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1e1e1e",
      "editorLineNumber.foreground": "#9e9e9e",
      "editorLineNumber.activeForeground": "#1e1e1e",
      "editorCursor.foreground": "#1e1e1e",
      "editor.selectionBackground": "#e0e0e0",
      "editor.lineHighlightBackground": "#f5f5f580",
    },
    tokenColors: [
      { token: 'keyword', foreground: '#1e1e1e', fontStyle: 'bold' },
      { token: 'comment', foreground: '#9e9e9e', fontStyle: 'italic' },
      { token: 'string', foreground: '#4e4e4e' },
      { token: 'number', foreground: '#4e4e4e' },
      { token: 'operator', foreground: '#1e1e1e' },
      { token: 'type', foreground: '#3e3e3e' },
      { token: 'function', foreground: '#3e3e3e' },
      { token: 'variable', foreground: '#1e1e1e' }
    ]
  },
  '~UwU~': {
    name: 'vs',
    customColors: {
      bgPrimary: '#feeeed',
      bgSecondary: '#fff0f8',
      bgTertiary: '#ffe6f5',
      bgSelected: '#ffd6ea',
      bgHover: '#ffdfec',
      bgAccent: '#f5a9cb',
      textPrimary: '#8e5c7e',
      textSecondary: '#c490b0',
      borderColor: '#ffcce7',
      borderPrimary: '#ffcce7',
      accentColor: '#f5a9cb',
      accentHover: '#ff9ecb',
      errorColor: '#ff6eb0',
      titlebarBg: '#feeeed',
      statusbarBg: '#feeeed',
      statusbarFg: '#8e5c7e',
      activityBarBg: '#feeeed',
      activityBarFg: '#8e5c7e',
      inlineCodeColor: '#f06999',
      
      // Explorer colors
      explorerFolderFg: '#f5a9cb',
      explorerFolderExpandedFg: '#ff9ecb',
      explorerFileFg: '#8e5c7e',
      explorerFileJavaScriptFg: '#e776ac',
      explorerFileTypeScriptFg: '#77a9d7',
      explorerFileJsonFg: '#b288bb',
      explorerFileHtmlFg: '#e776ac',
      explorerFileCssFg: '#77a9d7',
      explorerFileMarkdownFg: '#9d85be',
      explorerFileYamlFg: '#b288bb',
      explorerFileImageFg: '#e776ac',
      
      // Custom file extensions
      customFileExtensions: {
        'py': '#77d7a9',    // Python
        'rb': '#e77676',    // Ruby
        'php': '#b388bb',   // PHP
        'java': '#d7a977',  // Java
        'go': '#77c7d7',    // Go
        'rs': '#e79c76',    // Rust
        'c': '#77a9d7',     // C
        'cpp': '#77a9d7',   // C++
        'cs': '#77d7c7',    // C#
        'sql': '#d777a9',   // SQL
      },
    },
    editorColors: {
      "editor.background": '#fff0f8',
      "editor.foreground": '#8e5c7e',
      "editorLineNumber.foreground": '#d5b6c8',
      "editorLineNumber.activeForeground": '#aa7799',
      "editorCursor.foreground": '#f5a9cb',
      "editor.selectionBackground": '#ffd6ea',
      "editor.lineHighlightBackground": '#ffe6f580',
    },
    tokenColors: [
      { token: 'keyword', foreground: '#e776ac', fontStyle: 'bold' },
      { token: 'comment', foreground: '#c490b0', fontStyle: 'italic' },
      { token: 'string', foreground: '#9d85be' },
      { token: 'number', foreground: '#b288bb' },
      { token: 'operator', foreground: '#d978a9' },
      { token: 'type', foreground: '#77a9d7' },
      { token: 'function', foreground: '#9d81c7' },
      { token: 'variable', foreground: '#8e5c7e' }
    ]
  }
};