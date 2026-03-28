import React, { useState, useEffect, useRef } from 'react';

interface WebsiteMetadata {
  title?: string;
  description?: string;
  favicon?: string;
  domain?: string;
}

interface LinkHoverCardProps {
  url: string;
  children: React.ReactNode;
}

const LinkHoverCard: React.FC<LinkHoverCardProps> = ({ url, children }) => {
  const [metadata, setMetadata] = useState<WebsiteMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  const fetchWebsiteMetadata = async (url: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Try to fetch metadata from the backend
      const response = await fetch('http://127.0.0.1:23816/fetch_webpage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Backend response:', data); // Debug log
        
        if (data.success && data.content) {
          // Parse the HTML content to extract metadata
          const parser = new DOMParser();
          const doc = parser.parseFromString(data.content, 'text/html');
          
          // Debug: Log what we found
          console.log('Parsed document:', doc);
          console.log('Title element:', doc.querySelector('title'));
          console.log('Meta description:', doc.querySelector('meta[name="description"]'));
          console.log('Meta og:description:', doc.querySelector('meta[property="og:description"]'));
          console.log('Link icon:', doc.querySelector('link[rel="icon"]'));
          
          // Check if parsing was successful
          if (doc.querySelector('html') === null) {
            console.log('HTML parsing failed, trying fallback parsing');
            // Try to extract basic info using regex as fallback
            const titleMatch = data.content.match(/<title[^>]*>([^<]+)<\/title>/i);
            const descMatch = data.content.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
            const ogDescMatch = data.content.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
            const iconMatch = data.content.match(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
            
            if (titleMatch || descMatch || ogDescMatch || iconMatch) {
              setMetadata({
                title: titleMatch?.[1]?.trim() || extractDomain(url),
                description: descMatch?.[1]?.trim() || ogDescMatch?.[1]?.trim() || 'No description available',
                favicon: iconMatch?.[1] || null,
                domain: extractDomain(url),
              });
              return;
            }
          }
          
          // Extract title with multiple fallbacks
          let title = doc.querySelector('title')?.textContent?.trim();
          if (!title) {
            title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
          }
          if (!title) {
            title = doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')?.trim();
          }
          if (!title) {
            title = doc.querySelector('h1')?.textContent?.trim();
          }
          
          // Extract description with multiple fallbacks
          let description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();
          if (!description) {
            description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim();
          }
          if (!description) {
            description = doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content')?.trim();
          }
          if (!description) {
            // Try to get first paragraph text as fallback
            const firstP = doc.querySelector('p');
            if (firstP && firstP.textContent) {
              description = firstP.textContent.trim().substring(0, 150);
              if (description.length === 150) description += '...';
            }
          }
          
          // Try to find favicon with multiple strategies
          let favicon = doc.querySelector('link[rel="icon"]')?.getAttribute('href');
          if (!favicon) {
            favicon = doc.querySelector('link[rel="shortcut icon"]')?.getAttribute('href');
          }
          if (!favicon) {
            favicon = doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('content');
          }
          if (!favicon) {
            favicon = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
          }
          if (!favicon) {
            // Try to construct default favicon URL
            try {
              const urlObj = new URL(url);
              favicon = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;
            } catch (e) {
              console.log('Could not construct default favicon URL');
            }
          }
          
          // If favicon is relative, make it absolute
          if (favicon && !favicon.startsWith('http')) {
            try {
              const baseUrl = new URL(url);
              favicon = new URL(favicon, baseUrl.origin).href;
            } catch (e) {
              console.log('Could not make favicon absolute:', e);
              favicon = null;
            }
          }
          
          console.log('Extracted metadata:', { title, description, favicon });
          
          setMetadata({
            title: title || extractDomain(url),
            description: description || 'No description available',
            favicon,
            domain: extractDomain(url),
          });
        } else {
          throw new Error(data.error || 'Failed to fetch website data');
        }
      } else {
        throw new Error('Failed to fetch website data');
      }
    } catch (err) {
      console.error('Error fetching website metadata:', err);
      setError('Failed to load website information');
      // Fallback to basic domain info
      setMetadata({
        title: extractDomain(url),
        description: 'Unable to load website information',
        domain: extractDomain(url),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      // Always fetch fresh metadata on hover
      fetchWebsiteMetadata(url);
    }, 300); // Small delay to prevent flickering
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
    // Clear metadata when mouse leaves to ensure fresh fetch next time
    setMetadata(null);
    setError(null);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      
      {isVisible && (
        <div
          ref={cardRef}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '12px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '16px',
            minWidth: '280px',
            maxWidth: '320px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            zIndex: 1000,
            backdropFilter: 'blur(12px)',
            borderColor: 'var(--accent-color)',
            opacity: 0,
            animation: 'fadeIn 0.2s ease-out forwards',
          }}
        >
          
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Skeleton favicon */}
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-hover)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <div style={{ flex: 1 }}>
                {/* Skeleton title */}
                <div
                  style={{
                    height: '16px',
                    backgroundColor: 'var(--bg-hover)',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    width: '80%',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
                {/* Skeleton description */}
                <div
                  style={{
                    height: '12px',
                    backgroundColor: 'var(--bg-hover)',
                    borderRadius: '4px',
                    width: '60%',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--error-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  color: 'white',
                }}
              >
                ⚠️
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {metadata?.title || 'Error'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {error}
                </div>
              </div>
            </div>
          ) : metadata ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              {/* Favicon */}
              <div style={{ flexShrink: 0 }}>
                {metadata.favicon ? (
                  <img
                    src={metadata.favicon}
                    alt=""
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      objectFit: 'cover',
                    }}
                    onError={(e) => {
                      // Fallback to website icon if favicon fails to load
                      e.currentTarget.style.display = 'none';
                      const nextSiblingElement = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (nextSiblingElement) nextSiblingElement.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--accent-color)',
                    display: metadata.favicon ? 'none' : 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: 'white',
                    fontWeight: 'bold',
                  }}
                >
                  🌐
                </div>
              </div>
              
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '4px',
                    lineHeight: '1.3',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={metadata.title}
                >
                  {metadata.title}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.4',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  {metadata.description}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    marginTop: '4px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {metadata.domain}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
          
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateX(-50%) translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateX(-50%) translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
};

export default LinkHoverCard;
