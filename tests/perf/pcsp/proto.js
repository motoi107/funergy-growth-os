(function () {
  var orig = window.openModal;
  window.openModal = function () {
    var r = orig.apply(this, arguments);
    try {
      var b = document.getElementById('modal-body');
      b.classList.remove('m-md', 'm-lg', 'm-full');
      var inputs = b.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea').length;
      var tables = b.querySelectorAll('table').length;
      var wideTbl = Array.prototype.some.call(b.querySelectorAll('table'), function (t) { return t.scrollWidth > 520; });
      if (innerWidth >= 1024) { if (wideTbl) b.classList.add('m-lg'); else if (tables || inputs >= 6) b.classList.add('m-md'); }
      else if (innerWidth < 768) { if (inputs >= 3 || tables) b.classList.add('m-full'); }
    } catch (e) { }
    return r;
  };
})();
