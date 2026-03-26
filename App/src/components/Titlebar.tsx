import React, { useState, useEffect } from 'react';
import logo from '../assets/logo.png';


interface TitlebarProps {
  onOpenFolder?: () => void;
  onOpenFile?: () => void;
  onCloneRepository?: () => void;
  onToggleGitView?: () => void;
  onToggleExplorerView?: () => void;
  onToggleLLMChat?: () => void;
  onOpenSettings?: () => void;
  onToggleTerminal?: () => void;
  isGitViewActive?: boolean;
  isExplorerViewActive?: boolean;
  isLLMChatVisible?: boolean;
  terminalOpen?: boolean;
  currentFileName?: string;
  workspaceName?: string;
  titleFormat?: string;
}

interface SystemInfo {
  os: {
    system: string;
    release: string;
    version: string;
    machine: string;
    processor: string;
  };
  ram: {
    total: number;
    available: number;
    percent: number;
    used: number;
    free: number;
  };
  cpu: {
    physical_cores: number;
    total_cores: number;
    cpu_freq: any;
    cpu_percent: number;
  };
  gpu: Array<{
    id: number;
    name: string;
    load: number;
    memory_total: number;
    memory_used: number;
    memory_free: number;
    temperature: number;
  }>;
}

const Titlebar: React.FC<TitlebarProps> = ({ 
  onOpenFolder, 
  onOpenFile,
  onCloneRepository,
  onToggleGitView,
  onToggleExplorerView,
  onToggleLLMChat,
  onOpenSettings,
  onToggleTerminal,
  isGitViewActive,
  isExplorerViewActive,
  isLLMChatVisible,
  terminalOpen,
  currentFileName = "",
  workspaceName = "",
  titleFormat = "{filename} - {workspace} - Pointer"
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electron?.window) {
        const maximized = await window.electron.window.isMaximized();
        setIsMaximized(maximized);
      }
    };
    checkMaximized();
  
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, []);

  // Add click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isFileMenuOpen) {
        const target = e.target as HTMLElement;
        if (!target.closest('.file-menu-dropdown') && !target.closest('.file-menu-button')) {
          setIsFileMenuOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFileMenuOpen]);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const response = await fetch('http://127.0.0.1:23816/system-information');
        if (response.ok) {
          const data = await response.json();
          setSystemInfo(data);
        }
      } catch (error) {
        console.error('Error fetching system information:', error);
      }
    };

    fetchSystemInfo();
  }, []);

  const handleMinimize = () => {
    window.electron?.window?.minimize();
  };

  const handleMaximize = () => {
    window.electron?.window?.maximize();
  };

  const handleClose = () => {
    window.electron?.window?.close();
  };

  const handleTitleClick = () => {
    window.open('https://pointr.sh', '_blank');
  };

  const handleCloneRepository = () => {
    onCloneRepository?.();
    // Close the dropdown after selection
    setIsFileMenuOpen(false);
  };

  const handleOpenFile = () => {
    onOpenFile?.();
    // Close the dropdown after selection
    setIsFileMenuOpen(false);
  };

  const handleOpenFolder = () => {
    onOpenFolder?.();
    // Close the dropdown after selection
    setIsFileMenuOpen(false);
  };

  const isWindows = systemInfo?.os.system === 'Windows';

  // Format the title based on the template
  const formatTitle = () => {
    return titleFormat
      .replace('{filename}', currentFileName || '')
      .replace('{workspace}', workspaceName || '')
      .replace(/\s+-\s+(?:Pointer|-)+$/, ' - Pointer') // Clean up empty placeholders
      .replace(/^\s*-\s+/, ''); // Remove leading dash if filename is empty
  };

  return (
    <div className={`titlebar ${isWindows ? 'windows' : 'macos'}`}>
      <div className="titlebar-title" onClick={handleTitleClick}>
        {formatTitle()}
      </div>
      <div className={`titlebar-left ${isWindows ? 'windows' : 'macos'}`}>
        <img src={logo} alt="Pointer Logo" className="titlebar-logo" />
        <div className="titlebar-divider" />
        
        <div className="file-menu-container">
          <button 
            className="titlebar-action-button file-menu-button" 
            onClick={() => setIsFileMenuOpen(!isFileMenuOpen)}
            title="File Menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 2.5A1.5 1.5 0 0 1 3 1h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.12 3H13a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5v-10z" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            <span style={{ marginLeft: '4px' }}>File</span>
            <svg 
              width="10" 
              height="6" 
              viewBox="0 0 10 6" 
              fill="none" 
              xmlns="http://www.w3.org/2000/svg"
              style={{ marginLeft: '4px' }}
            >
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          {isFileMenuOpen && (
            <div className="file-menu-dropdown">
              <button 
                className="file-menu-item" 
                onClick={handleOpenFile}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h4.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12A1.5 1.5 0 0 1 12.5 3.62V14.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2.5 14.5v-13A1.5 1.5 0 0 1 4 0z" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
                <span>Open File</span>
              </button>
              
              <button 
                className="file-menu-item" 
                onClick={handleOpenFolder}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1.5 2.5A1.5 1.5 0 0 1 3 1h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.12 3H13a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12.5v-10z" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
                <span>Open Folder</span>
              </button>
              
              <div className="file-menu-divider"></div>
              
              <button 
                className="file-menu-item" 
                onClick={handleCloneRepository}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15.698 7.287L8.712 0.302C8.51 0.1 8.255 0 7.986 0C7.717 0 7.463 0.099 7.26 0.302L5.809 1.753L7.644 3.588C7.954 3.491 8.308 3.552 8.552 3.795C8.798 4.041 8.858 4.398 8.757 4.709L10.524 6.476C10.835 6.375 11.193 6.434 11.438 6.681C11.775 7.018 11.775 7.564 11.438 7.901C11.101 8.238 10.555 8.238 10.218 7.901C9.958 7.641 9.904 7.253 10.033 6.929L8.382 5.278V10.795C8.465 10.837 8.546 10.891 8.614 10.959C8.951 11.296 8.951 11.842 8.614 12.179C8.277 12.516 7.73 12.516 7.394 12.179C7.057 11.842 7.057 11.296 7.394 10.959C7.478 10.875 7.576 10.814 7.678 10.776V5.215C7.576 5.177 7.478 5.118 7.394 5.032C7.131 4.769 7.08 4.376 7.213 4.05L5.406 2.244L0.302 7.347C0.099 7.551 0 7.805 0 8.074C0 8.343 0.099 8.597 0.302 8.801L7.288 15.786C7.491 15.988 7.745 16.088 8.014 16.088C8.283 16.088 8.537 15.989 8.74 15.786L15.698 8.827C15.9 8.624 16 8.37 16 8.101C16 7.832 15.901 7.578 15.698 7.374V7.287Z" fill="currentColor"/>
                </svg>
                <span>Clone Repository</span>
              </button>
              
              <div className="file-menu-divider"></div>
              
              <button 
                className="file-menu-item"
                onClick={onOpenSettings}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.5 14H9.5C10 14 10.5 13.6 10.5 13V11.5C10.8 11.4 11.1 11.2 11.4 11L12.7 11.7C13.2 11.9 13.7 11.7 14 11.3L15.5 8.6C15.7 8.1 15.6 7.6 15.1 7.3L13.8 6.7C13.8 6.5 13.8 6.3 13.8 6.1L15.1 5.5C15.6 5.2 15.8 4.7 15.5 4.2L14 1.5C13.7 1.1 13.2 0.9 12.7 1.1L11.4 1.8C11.1 1.6 10.8 1.4 10.5 1.3V-0.2C10.5 -0.8 10 -1.2 9.5 -1.2H6.5C6 -1.2 5.5 -0.8 5.5 -0.2V1.3C5.2 1.4 4.9 1.6 4.6 1.8L3.3 1.1C2.8 0.9 2.3 1.1 2 1.5L0.5 4.2C0.3 4.7 0.4 5.2 0.9 5.5L2.2 6.1C2.2 6.3 2.2 6.5 2.2 6.7L0.9 7.3C0.4 7.6 0.2 8.1 0.5 8.6L2 11.3C2.3 11.7 2.8 11.9 3.3 11.7L4.6 11C4.9 11.2 5.2 11.4 5.5 11.5V13C5.5 13.6 6 14 6.5 14ZM8 8.5C7.2 8.5 6.5 7.8 6.5 7C6.5 6.2 7.2 5.5 8 5.5C8.8 5.5 9.5 6.2 9.5 7C9.5 7.8 8.8 8.5 8 8.5Z" fill="currentColor"/>
                </svg>
                <span>Settings</span>
                <span className="file-menu-shortcut">{isWindows ? "Ctrl+," : "⌘,"}</span>
              </button>
            </div>
          )}
        </div>

        <div className="titlebar-divider" />
            
        <div className="titlebar-actions">
          <button 
            className="titlebar-action-button" 
            onClick={onToggleExplorerView}
            title="Explorer (Ctrl+B)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2h12v2H2V2z" fill="currentColor"/>
              <path d="M2 5h12v9H2V5z" fill="currentColor"/>
              <path d="M3 6h4v1H3V6z" fill="currentColor"/>
              <path d="M3 8h10v1H3V8z" fill="currentColor"/>
              <path d="M3 10h10v1H3v-1z" fill="currentColor"/>
              <path d="M3 12h6v1H3v-1z" fill="currentColor"/>
            </svg>
            {isExplorerViewActive && <div className="active-indicator" />}
          </button>

          <button 
            className="titlebar-action-button" 
            onClick={onToggleGitView}
            title="Git"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.698 7.287L8.712 0.302C8.51 0.1 8.255 0 7.986 0C7.717 0 7.463 0.099 7.26 0.302L5.809 1.753L7.644 3.588C7.954 3.491 8.308 3.552 8.552 3.795C8.798 4.041 8.858 4.398 8.757 4.709L10.524 6.476C10.835 6.375 11.193 6.434 11.438 6.681C11.775 7.018 11.775 7.564 11.438 7.901C11.101 8.238 10.555 8.238 10.218 7.901C9.958 7.641 9.904 7.253 10.033 6.929L8.382 5.278V10.795C8.465 10.837 8.546 10.891 8.614 10.959C8.951 11.296 8.951 11.842 8.614 12.179C8.277 12.516 7.73 12.516 7.394 12.179C7.057 11.842 7.057 11.296 7.394 10.959C7.478 10.875 7.576 10.814 7.678 10.776V5.215C7.576 5.177 7.478 5.118 7.394 5.032C7.131 4.769 7.08 4.376 7.213 4.05L5.406 2.244L0.302 7.347C0.099 7.551 0 7.805 0 8.074C0 8.343 0.099 8.597 0.302 8.801L7.288 15.786C7.491 15.988 7.745 16.088 8.014 16.088C8.283 16.088 8.537 15.989 8.74 15.786L15.698 8.827C15.9 8.624 16 8.37 16 8.101C16 7.832 15.901 7.578 15.698 7.374V7.287Z" fill="currentColor"/>
            </svg>
            {isGitViewActive && <div className="active-indicator" />}
          </button>

          <button 
            className="titlebar-action-button" 
            onClick={onToggleLLMChat}
            title="Assistant (Ctrl+I)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1.33337C4.32 1.33337 1.33333 4.32004 1.33333 8.00004C1.33333 11.68 4.32 14.6667 8 14.6667C11.68 14.6667 14.6667 11.68 14.6667 8.00004C14.6667 4.32004 11.68 1.33337 8 1.33337ZM7.33333 12.0001V10.6667H8.66667V12.0001H7.33333ZM9.89333 7.49337C9.70667 7.79337 9.45333 8.04004 9.14667 8.34004C8.87333 8.60004 8.66667 8.86671 8.53333 9.13337C8.44 9.33337 8.4 9.54671 8.4 9.77337V10.0001H7.06667V9.73337C7.06667 9.37337 7.13333 9.04004 7.26667 8.74671C7.43333 8.39337 7.67333 8.08004 7.98 7.80004C8.27333 7.52671 8.49333 7.28004 8.63333 7.05337C8.76667 6.82671 8.83333 6.59337 8.83333 6.36004C8.83333 6.06671 8.73333 5.83337 8.53333 5.66671C8.33333 5.50004 8.06667 5.41337 7.73333 5.41337C7.4 5.41337 7.13333 5.50671 6.93333 5.70004C6.73333 5.89337 6.62 6.14671 6.6 6.46004H5.26667C5.28 5.77337 5.5 5.21337 5.93333 4.78004C6.36667 4.34671 6.97333 4.13337 7.76 4.13337C8.54667 4.13337 9.14667 4.34004 9.56 4.75337C9.97333 5.16671 10.1733 5.68671 10.1733 6.32004C10.1733 6.70671 10.08 7.05337 9.89333 7.49337Z" fill="currentColor"/>
            </svg>
            {isLLMChatVisible && <div className="active-indicator" />}
          </button>

          <button 
            className="titlebar-action-button" 
            onClick={onToggleTerminal}
            title="Terminal"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2h6v1H5V7zm0 2h6v1H5V9zm0 2h6v1H5v-1z" fill="currentColor"/>
            </svg>
            {terminalOpen && <div className="active-indicator" />}
          </button>

          <button 
            className="titlebar-action-button"
            onClick={onOpenSettings}
            title="Settings (⌘,)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 14H9.5C10 14 10.5 13.6 10.5 13V11.5C10.8 11.4 11.1 11.2 11.4 11L12.7 11.7C13.2 11.9 13.7 11.7 14 11.3L15.5 8.6C15.7 8.1 15.6 7.6 15.1 7.3L13.8 6.7C13.8 6.5 13.8 6.3 13.8 6.1L15.1 5.5C15.6 5.2 15.8 4.7 15.5 4.2L14 1.5C13.7 1.1 13.2 0.9 12.7 1.1L11.4 1.8C11.1 1.6 10.8 1.4 10.5 1.3V-0.2C10.5 -0.8 10 -1.2 9.5 -1.2H6.5C6 -1.2 5.5 -0.8 5.5 -0.2V1.3C5.2 1.4 4.9 1.6 4.6 1.8L3.3 1.1C2.8 0.9 2.3 1.1 2 1.5L0.5 4.2C0.3 4.7 0.4 5.2 0.9 5.5L2.2 6.1C2.2 6.3 2.2 6.5 2.2 6.7L0.9 7.3C0.4 7.6 0.2 8.1 0.5 8.6L2 11.3C2.3 11.7 2.8 11.9 3.3 11.7L4.6 11C4.9 11.2 5.2 11.4 5.5 11.5V13C5.5 13.6 6 14 6.5 14ZM8 8.5C7.2 8.5 6.5 7.8 6.5 7C6.5 6.2 7.2 5.5 8 5.5C8.8 5.5 9.5 6.2 9.5 7C9.5 7.8 8.8 8.5 8 8.5Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
      <div className={`titlebar-right ${isWindows ? 'windows' : 'macos'}`}>
        <div className="titlebar-controls">
          <button className="titlebar-button" onClick={handleMinimize}>
            −
          </button>
          <button className="titlebar-button" onClick={handleMaximize}>
            {isMaximized ? '❐' : '□'}
          </button>
          <button className="titlebar-button close" onClick={handleClose}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

export default Titlebar; 