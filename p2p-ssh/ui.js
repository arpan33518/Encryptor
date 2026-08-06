const blessed = require('blessed');

function initUI(onSendMessage) {
  // 1. Initialize the master canvas
  const screen = blessed.screen({
    smartCSR: true,
    title: 'P2P SSH Chat Engine'
  });

  // 2. Header / Status Bar (Top)
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      header: { fg: 'white', bg: 'blue' }
    },
    tags: true,
    content: '{bold}{cyan-fg} P2P SSH Chat {/cyan-fg}{/bold} | {yellow-fg}Status: Initializing...{/yellow-fg} | {gray-fg}[PgUp/PgDn: Scroll | Ctrl+C: Exit]{/gray-fg}'
  });

  // 3. The Message History Box (Middle portion)
  const messageList = blessed.box({
    parent: screen,
    width: '100%',
    height: '75%',     // Takes up middle 75%
    top: 3,            // Below status header
    left: 0,
    border: { type: 'line' },
    tags: true,        // Enables formatting tags like {bold}, {green-fg}, etc.
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      bg: 'blue'
    },
    label: ' Chat History '
  });

  // 4. The Input Box (Bottom portion)
  const input = blessed.textbox({
    parent: screen,
    width: '100%',
    height: '20%',     // Takes up the bottom 20%
    top: '80%',        // Starts at 80% mark
    left: 0,
    border: { type: 'line' },
    inputOnFocus: true, // Allows typing when focused
    label: ' Type a message or command like /help (Press Enter to send) '
  });

  // Handle pressing Enter to send a message
  input.on('submit', (text) => {
    if (text && text.trim().length > 0) {
      if (onSendMessage) {
        onSendMessage(text.trim());
      }
    }
    input.clearValue();
    input.focus();
    screen.render();
  });

  // Helper method to add a message line to history box
  function appendMessage(sender, content, timestamp) {
    const timeStr = timestamp 
      ? `{gray-fg}[${new Date(timestamp).toLocaleTimeString()}]{/gray-fg} ` 
      : `{gray-fg}[${new Date().toLocaleTimeString()}]{/gray-fg} `;
    
    let senderFormatted = `{bold}${sender}{/bold}`;
    if (sender === 'You' || sender === 'Me') {
      senderFormatted = `{green-fg}{bold}${sender}{/bold}{/green-fg}`;
    } else if (sender === 'System') {
      senderFormatted = `{yellow-fg}{bold}${sender}{/bold}{/yellow-fg}`;
    } else {
      senderFormatted = `{cyan-fg}{bold}${sender}{/bold}{/cyan-fg}`;
    }

    messageList.pushLine(`${timeStr}${senderFormatted}: ${content}`);
    messageList.setScrollPerc(100); // Auto-scroll to latest
    screen.render();
  }

  // Clear message box helper
  function clearHistory() {
    messageList.setContent('');
    screen.render();
  }

  // Set status helper
  function setStatus(statusText) {
    header.setContent(`{bold}{cyan-fg} P2P SSH Chat {/cyan-fg}{/bold} | ${statusText} | {gray-fg}[PgUp/PgDn: Scroll | Ctrl+C: Exit]{/gray-fg}`);
    screen.render();
  }

  // Scroll keys
  screen.key(['pageup'], () => {
    messageList.scroll(-5);
    screen.render();
  });

  screen.key(['pagedown'], () => {
    messageList.scroll(5);
    screen.render();
  });

  // Exit safely
  screen.key(['escape', 'C-c'], function (ch, key) {
    return process.exit(0);
  });

  // Focus the input box by default
  input.focus();

  // Render everything to the terminal
  screen.render();

  return {
    screen,
    header,
    messageList,
    input,
    appendMessage,
    clearHistory,
    setStatus
  };
}

module.exports = { initUI };

