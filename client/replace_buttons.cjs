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
      const lines = content.split('\n');
      // Find last import line index
      let insertIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import')) {
          insertIdx = i;
        }
      }
      if (insertIdx >= 0) {
        lines.splice(insertIdx + 1, 0, importLine);
        content = lines.join('\n');
      } else {
        // No imports, prepend at top
        content = importLine + '\n' + content;
      }
    }
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});

console.log('Button replacement completed.');
