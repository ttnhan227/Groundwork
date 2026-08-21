const fs = require('fs');
const path = require('path');
const glob = require('glob');

const srcDir = path.join(__dirname, 'src');

// Find all .tsx files
const files = glob.sync('**/*.tsx', { cwd: srcDir, absolute: true });

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;

  // Replace opening <button tags (including attributes) with <Button
  // Handles both self-closing and paired tags
  const buttonOpenRegex = /<button(\s+[^>]*?)>/g;
  content = content.replace(buttonOpenRegex, (match, attrs) => {
    modified = true;
    return `<Button${attrs}>`;
  });

  // Replace self-closing <button ... />
  const buttonSelfCloseRegex = /<button(\s+[^>]*?)\s*\/\s*>/g;
  content = content.replace(buttonSelfCloseRegex, (match, attrs) => {
    modified = true;
    return `<Button${attrs} />`;
  });

  // Replace closing tags </button>
  const buttonCloseRegex = /<\/button>/g;
  if (buttonCloseRegex.test(content)) {
    content = content.replace(buttonCloseRegex, '</Button>');
    modified = true;
  }

  if (modified) {
    // Ensure import exists
    const importLine = "import { Button } from '../../components/ui/Button';";
    if (!content.includes(importLine)) {
      // Insert after last import from relative paths (simple heuristic)
      const lines = content.split('\n');
      let insertIdx = lines.findIndex(l => l.startsWith('import'));
      // Find last import line
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith('import')) { insertIdx = i; break; }
      }
      lines.splice(insertIdx + 1, 0, importLine);
      content = lines.join('\n');
    }
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});

console.log('Button replacement completed.');
