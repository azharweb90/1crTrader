Here is the MD and application I just named as Test Application here because if someone checks my folder also then they should not understand what I'm building . 



One thing could you please do it . As of now our application is growing i know it is prototype no backend but still think you are an Frontend specialist . If you follow organizing rule like this naming and all the other developers cannot understand . I want you to organize the whole application files like a best frontend organized folder structure . 



Obviously we will move our Entire Project to a React Frontend Project soon once the prototypes are done for this whole application . That time we must not face any difficulty .  





Below is the prompt above is the story





You are an expert Frontend Architect specialized in refactoring legacy codebase structures and preparing applications for clean migrations to React. 

1CR Trader The current codebase suffers from unorganized file naming conventions, messy folder structures, and a single, overly lengthy `dashboard.css` file that contains styling for all pages and components combined. 

Help me design a refactoring strategy to rename files, split code logically, and architect a component-driven structure that directly prepares this app for a React conversion.

Please provide the solution in the following 4 phases:

### Phase 1: Clean, Standardized Folder Structure

Based on the current assets (app, Docs, pdfs, trade-diary-images, website, brand-assets, logo-new), design an optimized, industry-standard directory structure for a React app. 

- Use standard naming conventions (e.g., lowercase-kebab-case or PascalCase where appropriate).

- Show exactly where static assets (images/logos) and application source code should live.

### Phase 2: File Naming & Component Architecture

Map out how the unorganized HTML and JavaScript files should be split and renamed.

- Break down the core layout (e.g., Sidebar, Header, Main Content Area, Footer).

- Create a clear mapping table showing: [Legacy Content/File] -> [New Component Name] -> [React Component Purpose].

### Phase 3: Monolithic CSS Decomposition Strategy

Provide a strict, step-by-step technical plan to break down the massive `dashboard.css` file.

- Explain how to isolate Global/Reset styles from individual component styles.

- Tell me how to extract styles for specific elements (like cards, charts, forms, and custom buttons) into scoped styles.

- Recommend whether I should use CSS Modules, standard scoped CSS files, or a utility framework during this transition phase.

### Phase 4: Practical Execution Example

Choose one specific, high-priority UI section from a trading dashboard configuration form (e.g., an order form with inputs for Strike Price, Entry, Stop-Loss, Targets, and dynamic risk metrics). Show a concrete example of:

1. The suggested folder structure for just that component.

2. How its isolated CSS file should look once extracted from the massive style sheet.

3. A skeleton framework layout of how its clean, modular code will look.

