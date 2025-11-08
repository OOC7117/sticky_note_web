(() => {
  const STORAGE_KEY = 'sticky-notes-app';

  const noteForm = document.querySelector('#note-form');
  const titleInput = document.querySelector('#note-title');
  const contentInput = document.querySelector('#note-content');
  const submitButton = document.querySelector('.note-form__submit');
  const cancelButton = document.querySelector('.note-form__cancel');
  const searchInput = document.querySelector('#search-input');
  const notesList = document.querySelector('#notes-list');
  const emptyState = document.querySelector('#empty-state');
  const noteTemplate = document.querySelector('#note-template');

  let notes = loadNotes();
  let editingNoteId = null;

  renderNotes();

  noteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
      return;
    }

    if (editingNoteId) {
      updateNote(editingNoteId, { title, content });
    } else {
      createNote({ title, content });
    }

    resetForm();
    renderNotes();
  });

  cancelButton.addEventListener('click', () => {
    resetForm();
    clearHighlights();
  });

  searchInput.addEventListener('input', () => {
    renderNotes();
  });

  notesList.addEventListener('click', (event) => {
    const actionButton = event.target.closest('button.note__action');
    if (!actionButton) {
      return;
    }

    const noteElement = actionButton.closest('[data-note-id]');
    if (!noteElement) {
      return;
    }

    const noteId = noteElement.dataset.noteId;

    if (actionButton.classList.contains('note__action--edit')) {
      beginEdit(noteId);
    } else if (actionButton.classList.contains('note__action--delete')) {
      deleteNote(noteId);
      if (editingNoteId === noteId) {
        resetForm();
      }
      renderNotes();
    }
  });

  function createNote({ title, content }) {
    const newNote = {
      id: crypto.randomUUID(),
      title,
      content,
      updatedAt: new Date().toISOString(),
    };

    notes = [newNote, ...notes];
    persistNotes();
  }

  function updateNote(id, { title, content }) {
    notes = notes.map((note) =>
      note.id === id
        ? { ...note, title, content, updatedAt: new Date().toISOString() }
        : note
    );
    persistNotes();
  }

  function deleteNote(id) {
    notes = notes.filter((note) => note.id !== id);
    persistNotes();
  }

  function beginEdit(id) {
    const note = notes.find((item) => item.id === id);
    if (!note) {
      return;
    }

    editingNoteId = note.id;
    titleInput.value = note.title;
    contentInput.value = note.content;
    submitButton.textContent = 'Update note';
    cancelButton.hidden = false;
    highlightNote(id);
    titleInput.focus();
  }

  function resetForm() {
    noteForm.reset();
    editingNoteId = null;
    submitButton.textContent = 'Add note';
    cancelButton.hidden = true;
  }

  function loadNotes() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return [];
      }

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((note) => note && typeof note.id === 'string');
    } catch (error) {
      console.error('Failed to load notes from storage', error);
      return [];
    }
  }

  function persistNotes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function renderNotes() {
    clearHighlights();
    const query = searchInput.value.trim().toLowerCase();

    const filteredNotes = query
      ? notes.filter((note) =>
          note.title.toLowerCase().includes(query) ||
          note.content.toLowerCase().includes(query)
        )
      : notes;

    notesList.innerHTML = '';

    if (filteredNotes.length === 0) {
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;

    filteredNotes.forEach((note) => {
      const node = noteTemplate.content.firstElementChild.cloneNode(true);
      const titleEl = node.querySelector('.note__title');
      const contentEl = node.querySelector('.note__content');
      const timestampEl = node.querySelector('.note__timestamp');

      node.dataset.noteId = note.id;
      titleEl.textContent = note.title;
      contentEl.textContent = note.content;

      const updatedDate = new Date(note.updatedAt);
      timestampEl.dateTime = updatedDate.toISOString();
      timestampEl.textContent = `Updated ${formatRelativeDate(updatedDate)}`;

      notesList.appendChild(node);
    });
  }

  function highlightNote(id) {
    clearHighlights();
    const noteElement = notesList.querySelector(`[data-note-id="${id}"]`);
    if (noteElement) {
      noteElement.classList.add('note--highlight');
      noteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearHighlights() {
    notesList
      .querySelectorAll('.note--highlight')
      .forEach((element) => element.classList.remove('note--highlight'));
  }

  function formatRelativeDate(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 60000) {
      return 'just now';
    }

    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
})();
