function formatControlCharacter(character: string): string {
  switch (character) {
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    case "\u001B":
      return "\\x1b";
    default:
      return `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
  }
}

export function sanitizeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, formatControlCharacter);
}
