(() => {
  const { refs, ui } = window.App;

  const handleChange = e => ui.handleFiles(e.target.files);

  const openFilePicker = () => {
    const i = refs.fileInput;
    i.value = '';
    i.multiple = false;
    i.removeAttribute('webkitdirectory');
    i.removeAttribute('directory');
    i.click();
  };

  const dirInput = document.createElement('input');
  dirInput.type = 'file';
  dirInput.webkitdirectory = true;
  dirInput.addEventListener('change', handleChange);

  refs.uploadFileButton.addEventListener('click',   openFilePicker);
  refs.uploadFolderButton.addEventListener('click', () => dirInput.click());
  refs.fileInput.addEventListener('change',         handleChange);
})();
