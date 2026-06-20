document.addEventListener('DOMContentLoaded', () => {
  
  // --- Navigation & Scrollspy ---
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('.year-section');

  const highlightNav = () => {
    let scrollPosition = window.scrollY + 100; // Offset for navbar

    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');

      if (scrollPosition >= top && scrollPosition < top + height) {
        navLinks.forEach(link => {
          link.classList.remove('active');
          if (link.getAttribute('data-section') === id) {
            link.classList.add('active');
          }
        });
      }
    });
  };

  window.addEventListener('scroll', highlightNav);

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
});
