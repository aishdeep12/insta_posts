# insta_posts

Images and captions for the analytunb Instagram page. Instagram posts are published through Publora, which downloads each image from a public direct link, so this repo is public.

## Layout

```
posts/
  YYYY-MM-DD-short-topic/
    slide-1.png ... slide-N.png   images in posting order
    caption.md                    final caption, format and sources
```

One folder per post, named with the post date and a short topic slug.

## Direct image link pattern

```
https://raw.githubusercontent.com/aishdeep12/insta_posts/main/posts/YYYY-MM-DD-short-topic/slide-1.png
```

Use these links as `mediaUrls` when creating the post in Publora.
