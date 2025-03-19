new Swiper('.card-wrapper', {
    spaceBetween: 30,
  
    // If we need pagination
    pagination: {
      el: '.swiper-pagination',
      clickable: true,
      dynamicBullets: true,
    },
  
    // Navigation arrows
    navigation: {
      nextEl: '.swiper-button-next',
      prevEl: '.swiper-button-prev',
    },
  
    breakpoints: {
        0 : {
            slidesPerView: 1
        },
        768: {
            slidesPerView: 2
        }, 
        1024: {
            slidesPerView: 3
        }
    }

  });





  let next = document.querySelector('.next')
let prev = document.querySelector('.prev')

next.addEventListener('click', function(){
    let items = document.querySelectorAll('.item')
    document.querySelector('.slide').appendChild(items[0])
})

prev.addEventListener('click', function(){
    let items = document.querySelectorAll('.item')
    document.querySelector('.slide').prepend(items[items.length - 1]) // here the length of items = 6
})



document.querySelectorAll('.item').forEach(item => {
    const video = item.querySelector('video');
    const cover = item.querySelector('img.cover');

    // Quando entri nell'item
    item.addEventListener('mouseenter', () => {
        cover.style.opacity = "0";
        video.style.opacity = "1";
        video.play();
    });

    // Quando esci dall'item
    item.addEventListener('mouseleave', () => {
        cover.style.opacity = "1";
        video.style.opacity = "0";
        video.pause();
        video.currentTime = 0; // Riavvia il video
    });
});
