// Inizializzazione di Swiper
// Questo blocco inizializza un'istanza di Swiper per l'elemento '.card-wrapper'.
// Configura lo spazio tra le slide, il numero di slide visibili a diverse dimensioni dello schermo
// e abilita i controlli di paginazione e navigazione.
new Swiper('.card-wrapper', {
    spaceBetween: 30,
    slidesPerView: 1,

    pagination: {
        el: '.swiper-pagination',
        clickable: true,
        dynamicBullets: true,
    },

    navigation: {
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev',
    },

    breakpoints: {
        768: { slidesPerView: 2 },
        1024: { slidesPerView: 3 }
    }
});

// Movies Section

const nextButton = document.querySelector('.next');
const prevButton = document.querySelector('.prev');
const slideContainer = document.querySelector('.slide');

nextButton.addEventListener('click', () => {
    const items = document.querySelectorAll('.item');
    slideContainer.appendChild(items[0]);
});

prevButton.addEventListener('click', () => {
    const items = document.querySelectorAll('.item');
    slideContainer.prepend(items[items.length - 1]);
});

document.querySelectorAll('.item').forEach(item => {
    const video = item.querySelector('video');
    const cover = item.querySelector('img.cover');

    item.addEventListener('mouseenter', () => {
        cover.style.opacity = "0";
        video.style.opacity = "1";
        video.play();
    });

    item.addEventListener('mouseleave', () => {
        cover.style.opacity = "1";
        video.style.opacity = "0";
        video.pause();
        video.currentTime = 0;
    });
});

