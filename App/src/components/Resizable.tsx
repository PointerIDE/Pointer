import React, { useState, useCallback, useEffect, useRef } from 'react';

interface ResizableProps {
  children: React.ReactNode;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  isCollapsed: boolean;
  onCollapse: () => void;
  shortcutKey?: string;
}

const Resizable: React.FC<ResizableProps> = ({
  children,
  defaultWidth,
  minWidth,
  maxWidth,
  isCollapsed,
  onCollapse,
  shortcutKey,
}) => {
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hoverCollapse, setHoverCollapse] = useState(false);
  const [hoverDrag, setHoverDrag] = useState(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartWidthRef = useRef<number>(width);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = width;
    
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  }, [width]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        const deltaX = e.clientX - dragStartXRef.current;
        const newWidth = Math.min(Math.max(dragStartWidthRef.current + deltaX, minWidth), maxWidth);
        
        if (newWidth !== width) {
          setWidth(newWidth);
          window.dispatchEvent(new Event('resize'));
        }
      });
    }
  }, [isDragging, minWidth, maxWidth, width]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true });
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mouseleave', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseleave', handleMouseUp);
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    window.dispatchEvent(new Event('resize'));
  }, [defaultWidth]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shortcutKey === 'sidebar' && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onCollapse();
      } else if (shortcutKey === 'topbar' && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onCollapse();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCollapse, shortcutKey]);

  return (
    <div
      className="resizable"
      ref={containerRef}
      style={{
        width: isCollapsed ? 0 : width,
        minWidth: isCollapsed ? 0 : minWidth,
        maxWidth,
        position: 'relative',
        transition: isDragging ? 'none' : 'width 0.2s ease',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {children}
      <div
        className="collapse-button"
        onClick={onCollapse}
        style={{
          position: 'absolute',
          right: -12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 12,
          height: 48,
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: '10px',
          opacity: hoverCollapse ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
        onMouseEnter={() => setHoverCollapse(true)}
        onMouseLeave={() => setHoverCollapse(false)}
      >
        <span style={{ 
          transform: isCollapsed ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s ease',
        }}>
          ⟨
        </span>
      </div>
      <div
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHoverDrag(true)}
        onMouseLeave={() => setHoverDrag(false)}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          cursor: 'col-resize',
          background: isDragging ? 'var(--accent-color)' : hoverDrag ? 'var(--accent-color)' : 'transparent',
          transition: 'background-color 0.2s ease',
        }}
      />
    </div>
  );
};

export default Resizable; 