# thread-gpm

# thread-tool

Dự án gồm Chrome extension **0.11.30** và tool riêng điều khiển GPM **0.3.2**. Cả hai dùng chung bộ chạy phiên, đọc DOM Threads, lọc bài bằng AI và logic comment. Không dùng API Threads.

## Tool GPM

```sh
cd gpm-tool
npm ci
npm start
```

Mở http://127.0.0.1:4317. Tự mở profile GPM và đăng nhập Threads, nhập CDP của profile, lưu key/model/prompt rồi Start. Chọn profile, nhập proxy nếu cần hoặc để trống để mở không proxy. Lưu rồi bấm Áp dụng cấu hình & mở profile: tool cập nhật mạng trước khi mở và tự lấy CDP. Xem [hướng dẫn tool](gpm-tool/README.md).

UI có Start/Stop, log trực tiếp, thống kê, xuất lịch sử, chỉnh prompt và folder ảnh. Bảng profile cho chọn chạy đồng thời; phiên, lịch sử và lịch nghỉ được tính riêng theo Profile ID. Tool chạy bằng Node độc lập, không cần cài extension trong profile. Dừng phiên extension trước khi dùng tool.

## Chrome extension

Mở chrome://extensions, bật Developer mode, chọn Load unpacked với thư mục extension. Nhập API key trong UI và Lưu. Bản GitHub/ZIP kết hợp không chứa key mặc định.

## Luồng hiện tại

* Dùng tab Threads hiện có, chờ tải ban đầu 15 giây. Gom bài mới, AI chọn bài tiếng Việt ưu tiên mua sắm; giữ lịch sử để tránh gửi trùng.
* Ghép ngang tối đa 3 ảnh bài gốc cho AI. Lượt comment ảnh gửi 3 file riêng: 2 ảnh ngẫu nhiên và app_store.png ở giữa; bộ mặc định gồm 13 ảnh.
* Lượt ảnh cách nhau ngẫu nhiên 6–8 phút; lượt giữa dùng chữ và @hoanxu.app. Nghỉ sau comment mặc định 120–180 giây; thời gian thực tế còn phụ thuộc tìm bài và xử lý.
* Sau click Post, ghi sent_unverified, chờ 30–40 giây rồi về trang chủ. Không chờ xác minh URL theo cấu hình hiện tại; thống kê là lần gửi, không bảo đảm đã đăng. Nếu có URL đã xác minh trước đó, lịch sử vẫn giữ URL đó.
* Mỗi phiên 25 lần gửi, đóng tab Threads của phiên và nghỉ 3 giờ rồi mở tab mới tiếp tục. Giữ tab trống khi cần để không đóng cửa sổ cuối của profile.
* Stop hủy lịch tiếp theo. Trạng thái và receipt lưu trên máy; không tự gửi lại bài có kết quả chưa rõ. Lỗi đăng nhập/quota vẫn cần xử lý.

Giữ trình duyệt, máy và Node (nếu dùng tool) hoạt động. Trạng thái tab, đăng nhập, mạng và DOM Threads có thể ảnh hưởng phiên chạy.

## Kiểm thử

```sh
npm test
npm run test:all --prefix gpm-tool
```

Kiểm thử tool dùng Chrome tạm và trang fixture, không đăng thật. Dữ liệu riêng ở gpm-tool/data, key/proxy, node_modules và ZIP không đưa vào Git. Không chia sẻ file state.json.

API key tự cấu hình: [hướng dẫn](CAU-HINH-KEY.md). Bản EXE/DMG mới không nhúng key.
