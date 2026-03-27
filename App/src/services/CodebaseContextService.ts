/**
 * Service for fetching and providing codebase context to the AI
 */
export class CodebaseContextService {
  
  /**
   * Fetch initial codebase context from the backend
   */
  static async getInitialCodebaseContext(): Promise<string> {
    try {
      const response = await fetch('http://localhost:23816/api/codebase/overview');
      
      if (!response.ok) {
        logger.warn('Codebase overview not available', { status: response.status });
        return '';
      }
      
      const data = await response.json();
      
      if (data.error) {
        logger.warn('Codebase overview error', { error: data.error });
        return '';
      }
      
      // Format the codebase context for the AI
      const overview = data.overview;
      const summary = data.summary;
      
      if (!overview || !summary) {
        return '';
      }
      
      let context = `# Codebase Overview\n\n${summary}\n\n`;
      
      // Add technical details
      if (overview.framework_info && Object.keys(overview.framework_info).length > 0) {
        context += `## Technology Stack\n`;
        for (const [key, value] of Object.entries(overview.framework_info)) {
          context += `- ${key}: ${value}\n`;
        }
        context += '\n';
      }
      
      // Add main directories
      if (overview.main_directories && overview.main_directories.length > 0) {
        context += `## Main Directories\n`;
        overview.main_directories.forEach((dir: string) => {
          context += `- ${dir}/\n`;
        });
        context += '\n';
      }
      
      // Add key files
      if (overview.key_files && overview.key_files.length > 0) {
        context += `## Key Configuration Files\n`;
        overview.key_files.forEach((file: string) => {
          context += `- ${file}\n`;
        });
        context += '\n';
      }
      
      // Add language breakdown
      if (overview.languages && Object.keys(overview.languages).length > 0) {
        context += `## Language Distribution\n`;
        const sortedLangs = Object.entries(overview.languages)
          .sort(([,a], [,b]) => (b as number) - (a as number))
          .slice(0, 5); // Top 5 languages
        
        sortedLangs.forEach(([lang, count]) => {
          context += `- ${lang}: ${count} files\n`;
        });
        context += '\n';
      }
      
      context += `This project has been automatically indexed. You can use get_codebase_overview(), search_codebase(), and get_file_overview() tools to explore the codebase structure and find specific code elements.`;
      
      return context;
      
    } catch (error) {
      logger.warn('Failed to fetch codebase context', error);
      return '';
    }
  }
  
  /**
   * Check if codebase indexing is available
   */
  static async isCodebaseIndexed(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:23816/api/codebase/overview');
      const data = await response.json();
      return response.ok && !data.error;
    } catch {
      return false;
    }
  }
} 