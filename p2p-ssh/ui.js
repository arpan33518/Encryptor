const blessed = require('blessed');

function initUI(onSendMessage) {
  // 1. Initialize the master canvas
  const screen = blessed.screen({
    smartCSR: true,
    title: 'P2P SSH Chat'
  });

  // 2. The Message History Box (Top portion)
  const messageList = blessed.box({
    parent: screen,
    width: '100%',
    height: '80%',     // Takes up the top 80% of the terminal
    top: 0,            // Starts at the very top row
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

  // 3. The Input Box (Bottom portion)
  const input = blessed.textbox({
    parent: screen,
    width: '100%',
    height: '20%',     // Takes up the bottom 20%
    top: '80%',        // Starts at 80% mark
    left: 0,
    border: { type: 'line' },
    inputOnFocus: true, // Allows typing when focused
    label: ' Type a message (Press Enter to send) '
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

  // 4. Let the user exit the app safely
  screen.key(['escape', 'C-c'], function (ch, key) {
    return process.exit(0);
  });

  // Focus the input box by default
  input.focus();

  // Render everything to the terminal
  screen.render();

  return {
    screen,
    messageList,
    input,
    appendMessage
  };
}

module.exports = { initUI };
