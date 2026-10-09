# Hướng dẫn GPM Tool cho người mới

## 1. Mở GPM và tool

Mở GPM trên máy chạy tool. GPMLogin v4 trên Windows thường dùng `http://127.0.0.1:19995/api/v3`; GPMLogin Global dùng cổng trong cài đặt GPM và `/api/v1`. Địa chỉ được chỉnh trong **Cài đặt → Kết nối GPM**. Nếu báo không kết nối được GPM, kiểm tra GPM đã mở và Local API hoạt động đúng cổng.

Mở dashboard tại http://127.0.0.1:4317. Đây là địa chỉ trên máy đang chạy tool.

Nếu chưa chạy dashboard, mở Terminal trong thư mục `gpm-tool`, chạy `npm start`. Lần đầu cài trên máy mới cần Node.js 20 trở lên và chạy `npm ci` trước. Giữ Terminal đang chạy; nếu hiện thông báo tool đã chạy, mở dashboard hiện tại thay vì khởi động thêm bản khác.

### Lệnh khởi động trên máy hiện tại (macOS)

Mở GPMLogin Global trước. Nếu tool chưa chạy, mở Terminal và chạy:

```sh
cd "/Users/vinhtran/Documents/Codex/2026-10-06/ba/outputs/thread-tool/gpm-tool"
npm start
```

Khi Terminal hiện `GPM tool UI: http://127.0.0.1:4317`, mở địa chỉ đó trong trình duyệt. Giữ cửa sổ Terminal hoạt động trong khi chạy tool.

Nếu là lần đầu cài lại và chưa có dependencies, chạy trước:

```sh
cd "/Users/vinhtran/Documents/Codex/2026-10-06/ba/outputs/thread-tool/gpm-tool"
npm ci
npm start
```

Không cần chạy `npm ci` mỗi lần mở tool. Nếu báo tool đang chạy hoặc cổng 4317 đã được dùng, mở dashboard hiện tại; không khởi động thêm một bản.

Để dừng hẳn: xoá bộ lọc, tích **Chọn đang hiển thị** rồi bấm **Dừng & đóng**, đợi các profile dừng/đóng xong, rồi bấm `Ctrl+C` ở Terminal. Chỉ bấm `Ctrl+C` khi phiên còn chạy sẽ giữ checkpoint để khôi phục lần sau.

## 2. Thêm profile

### Dùng profile đã có trong GPM

1. Bấm **+ Thêm profile → Có sẵn trong GPM**.
2. Tìm bằng tên/ID hoặc chọn nhóm GPM. Bấm dòng hoặc ô tích để chọn; danh sách không tự chọn sẵn.
3. Bấm **Thêm N profile vào tool**. Có thể dùng **Chọn tất cả profile có thể thêm** nếu muốn lấy cả danh sách đang hiển thị.
4. Tool chọn các profile vừa thêm và hiện hướng dẫn bước tiếp theo.

Nếu dùng file, chọn **+ Thêm profile → Nhập file danh sách**, chọn file JSON/CSV/TXT hoặc dán danh sách, rồi **Xem trước danh sách**, chọn profile và thêm vào tool.

Profile đã có trong tool được bỏ qua, giữ cấu hình/lịch sử. Chỉ có tên thì cần khớp duy nhất trong GPM; khi trùng tên, dùng ID. Tên và proxy được đọc từ GPM hiện tại. Nhập danh sách chưa mở profile và chưa chạy automation. File Excel/gói backup chưa hỗ trợ qua luồng này.

Profile mới nhập dùng cấu hình AI, nhịp chạy và folder ảnh đã lưu của tool; nháp chưa lưu không được dùng. Sau khi nhập, kiểm tra cài đặt chung.

### Tạo profile GPM mới

1. Bấm **+ Thêm profile → Tạo profile mới**.
2. Nhập tên dễ nhận biết, ví dụ `Threads 01`.
3. Nhập proxy nếu dùng; nếu không, để trống.
4. Có thể để trống phiên bản Chrome để tool lấy phiên bản từ profile Chrome hiện có trong GPM. Nếu không có profile tham chiếu, nhập đúng phiên bản Chrome đã cài trong GPM.
5. Bấm **Tạo và thêm vào tool**. Tool chọn đúng profile vừa tạo, chưa mở trình duyệt hoặc chạy tự động.

## 3. Nhập hoặc đổi proxy

Trong hàng profile, bấm **Sửa profile**. Nhập proxy rồi bấm **Lưu profile**.

Ví dụ định dạng (không phải proxy sử dụng được):

```text
203.0.113.10:8080:username:password
```

Dùng địa chỉ, cổng, tài khoản và mật khẩu do bên cung cấp proxy đưa. Để trống ô proxy nghĩa là bỏ proxy. Tool cũng nhận proxy dạng URL HTTP/HTTPS/SOCKS5.

Nếu profile đang chạy, bấm **Dừng profile** trước khi sửa. Đổi proxy sẽ đóng trình duyệt profile đó; sau khi lưu, bấm **Mở** để mở lại. Tên và proxy thay đổi bên GPM được cập nhật lên bảng khoảng mỗi 3 giây. Khi mở/chạy, tool đọc lại proxy hiện tại từ GPM.

## 4. Mở profile và đăng nhập Threads

1. Bấm thẻ để chọn một hoặc nhiều profile, rồi bấm **Mở trình duyệt**. Hoặc bấm **Mở** ngay trên một thẻ.
2. Trong cửa sổ GPM vừa mở, đăng nhập Threads bằng tài khoản của profile đó.
3. Kiểm tra đã xem được bảng tin, xử lý xong các yêu cầu đăng nhập/xác minh và đóng popup còn mở.

Nút **Mở** và **Mở trình duyệt** chỉ mở/kết nối profile GPM, không tự mở tab hoặc chuyển trang sang Threads. Các tab GPM khôi phục khi mở profile vẫn giữ nguyên. Bạn có thể tự vào Threads để đăng nhập. Khi bấm **Chạy tự động**, tool mới mở Threads nếu chưa có tab và bắt đầu phiên comment. Không cần tự nhập cổng CDP.

## 5. Cài đặt AI và nhịp chạy

1. Mở phần **Cài đặt**; phạm vi mặc định là tất cả profile.
2. Điền API key của dịch vụ AI mà tool đang dùng: `https://ai.hoanxu.com/v1`. Không tự thay bằng key của một dịch vụ khác.
3. Chọn model được key đó hỗ trợ; có thể dùng **Tải danh sách model**. Khi đổi key, lưu trước rồi tải danh sách vì nút tải dùng key đã lưu.
4. Kiểm tra **Hướng dẫn cho AI (prompt)** và **Chủ đề muốn tìm** để phù hợp nội dung muốn xử lý.
5. Người mới có thể giữ mặc định: gõ 60ms, chờ giữa bước 2 giây, nghỉ tìm bài 30 giây, nghỉ trung bình 150 giây (tự dao động 120–180 giây).
6. Chọn bật/tắt **Cuộn nhẹ lên/xuống khi nghỉ** và **Thả tim khi chờ**.
7. Ảnh: để trống folder để dùng ảnh đi kèm. Folder riêng cần `app_store.png` và ít nhất 2 ảnh khác; bấm **Kiểm tra folder** trước khi lưu.
8. Bấm **Lưu cho tất cả profile**, đợi báo đã lưu.

Để trống API key khi sửa cài đặt sẽ giữ key đã lưu. AI, model, prompt, ảnh, chủ đề và nhịp chạy dùng chung cho tất cả profile. Proxy, kết nối và lịch sử được giữ riêng. Có thể đổi nhịp chạy, chủ đề và AI khi đang chạy: bấm **Lưu cho tất cả profile**, bước tiếp theo dùng cài đặt mới; thao tác đang thực hiện tiếp tục hoàn tất. Đổi kết nối hoặc proxy cần dừng profile trước.

## 6. Chạy tool

Bấm thẻ để chọn profile, sau đó **Chạy tự động**. Tool mở profile nếu cần, bắt đầu tìm bài, gọi AI và đăng bình luận bằng cài đặt chung đã lưu. Nên chạy một profile trước để quan sát kết quả.

Mỗi bài có xác suất 60% được chọn follow trước khi bình luận; 40% còn lại chỉ bình luận. Tool lưu lựa chọn theo bài trong từng profile, không bốc lại khi thử lại. Follow chỉ dùng nút (+) ở avatar ngay trong bài và xử lý popup xác nhận đúng tài khoản; không chuyển sang trang cá nhân. Nếu chưa bấm nút và không thấy nút follow khả dụng, tool ghi log bỏ qua follow rồi tiếp tục bình luận tại bài. Người đã theo dõi được bỏ qua; tool không bấm unfollow. Sau khi xác nhận follow mới, tool đợi ngẫu nhiên 210–270 giây (quanh 4 phút) rồi bình luận. Log cập nhật thời gian còn lại mỗi 15 giây; có thể bấm Dừng trong lúc chờ. Nếu đã bấm follow nhưng trạng thái hoặc popup chưa rõ, tool báo lỗi và chưa gửi bình luận. Chế độ dry-run và nút Mở không follow hay gửi bình luận.

Muốn chạy nhiều profile, kiểm tra đăng nhập từng profile và lưu cài đặt chung trước, rồi chọn các profile cần chạy. Thanh thao tác giữ trên màn hình khi cuộn; **Bỏ chọn** xoá toàn bộ lựa chọn. Nếu chọn profile nằm ngoài bộ lọc hiện tại, tool báo số lượng cạnh phần chọn.

Theo dõi **Xem log** ở từng hàng, trạng thái phiên, **Phiên /10**, **Hôm nay / Tổng**, lượt tiếp theo và lịch sử. “Chưa xác minh” nghĩa là đã ghi nhận gửi nhưng chưa xác nhận được comment; kiểm tra bài gốc trước khi thao tác thủ công để tránh trùng.

Mỗi phiên có 10 lần gửi, sau đó nghỉ 3 giờ rồi tiếp tục. Mỗi profile có bộ đếm, lịch nghỉ và lịch sử riêng. Thả tim khi nghỉ tối đa 3 bài, cách nhau 20–45 giây; các bước tương tác mặc định cách nhau khoảng 2–3.5 giây. Bỏ qua tương tác nếu không đủ thời gian nghỉ, không rút ngắn nhịp bấm để kịp.

Giữ máy, GPM và dashboard hoạt động để tiếp tục đúng lịch. Không chạy automation của extension đồng thời với tool trên cùng profile.

## 7. Dừng và xử lý lỗi

- **Dừng profile**: gửi lệnh dừng ngay tới GPM và hủy lịch của profile đó.
- **Dừng & đóng**: dừng và đóng nhóm được chọn; hủy các lượt mở còn chờ trong hàng đợi.
- Muốn dừng toàn bộ: xoá bộ lọc, tích **Chọn đang hiển thị**, bấm **Dừng & đóng**.
- Chỉ đóng trang dashboard không phải yêu cầu dừng. Muốn dừng hẳn, dùng các nút dừng trước khi tắt tool.
- **Mở/Chạy bị khóa**: chưa chọn profile, tất cả profile được chọn đang chạy/dừng hoặc tool đang xử lý yêu cầu khác.
- **AI timeout**: mỗi request chờ tối đa 90 giây; lỗi thì nghỉ 120 giây và thử lại tối đa 3 lần sau lần đầu. Nếu hết lượt, xem nguyên nhân trong log, kiểm tra key/model/kết nối rồi chạy lại.
- **GPM chưa đồng bộ**: kiểm tra GPM và Local API. CDP chưa kết nối không chứng minh profile đã đóng; trạng thái mở/đóng có thể chưa xác định.
- **Invalid origin/token**: tải lại dashboard ở đúng địa chỉ `http://127.0.0.1:4317`, tránh mở nhiều bản tool cùng dữ liệu. Tool có cơ chế tải lại token khi token cũ bị từ chối.

Luồng lần đầu: mở GPM → thêm/nhập profile → nhập proxy → Mở trình duyệt → đăng nhập Threads → Cài đặt AI → Lưu và áp dụng → chọn profile → Chạy tự động → theo dõi log.

Thời gian nghỉ sau bình luận dùng một giá trị trung bình: mặc định 150 giây, mỗi lượt dao động ngẫu nhiên ±20% (120–180 giây). Bấm Lưu và áp dụng để dùng giá trị mới từ lượt nghỉ tiếp theo.

Đổi model rồi bấm **Lưu cho tất cả profile** sẽ áp dụng chính model đang chọn (Sol, Luna hoặc model khác) cho mọi profile đã thêm và profile mới. Lượt AI đang thực hiện hoàn tất; lần gọi AI tiếp theo dùng model mới. Nhật ký ghi model được dùng khi lọc bài và tạo bình luận. Nếu một profile chưa áp dụng được, giao diện báo lỗi để bấm Lưu thử lại.

## 8. Chuyển profile sang máy khác, giữ cookie/phiên Threads

### Trên máy nguồn

1. Bấm **Mở** cho các profile cần chuyển; kiểm tra Threads vẫn đang đăng nhập trong GPM.
2. Trong tool, bấm **Xuất / Chuyển máy**.
3. Chọn **Chuyển máy · kèm cookie/phiên Threads**. Chọn tất cả hoặc chỉ các profile đang tích, tối đa 50 profile / 5 MB mỗi file.
4. Bấm **Tải file JSON**. Chuyển file `hoanxu-transfer-....json` sang máy đích.

### Trên máy đích

1. Cài và mở GPM, bật Local API. Mở tool, kiểm tra địa chỉ GPM trong Cài đặt đúng máy đích.
2. Bấm **+ Thêm profile → Nhập file danh sách**, chọn file chuyển máy rồi **Xem trước danh sách**.
3. Nếu cần, nhập **Phiên bản Chrome trên máy đích** (phiên bản đã cài trong GPM) rồi xem trước lại. Để trống sẽ dùng phiên bản trong file.
4. Chọn profile cần nhập rồi xác nhận. Tool tạo profile GPM khi chưa có ID tương ứng, đặt tên/proxy, mở trình duyệt và khôi phục cookie, local storage của Threads/Meta.
5. Kiểm tra đăng nhập trong GPM trước khi bấm **Chạy tự động**. Cài đặt AI và nhịp chạy dùng cấu hình chung của tool trên máy đích.

Profile đã có trong tool được bỏ qua để giữ phiên hiện tại. Nếu nhập lỗi, profile đã tạo được đánh dấu để lần nhập lại thử khôi phục tiếp, không tạo trùng. Import không tự chạy automation.

File chứa proxy và dữ liệu đăng nhập; giữ riêng tư như tài khoản của bạn. File không chứa API key hay lịch sử gửi của tool. Đây là gói cookie/local storage cho Threads/Meta, không phải bản backup đầy đủ GPM: không sao chép toàn bộ fingerprint, mật khẩu lưu, extension, IndexedDB hoặc dữ liệu trình duyệt khác. Threads có thể yêu cầu đăng nhập/xác minh lại nếu phiên hết hạn hoặc kiểm tra khi đổi máy. Chưa xác minh trên hai máy với tài khoản thật.

### Chỉ chuyển danh sách

Chọn **Chỉ danh sách ID và tên** để tải file `hoanxu-profiles-....json`. Trên máy đích, các profile tương ứng cần có sẵn trong GPM. Nhập file, xem trước, chọn và thêm các profile còn thiếu. Tên/proxy lấy lại từ GPM; các profile đã có được bỏ qua.

File danh sách từ tool hỗ trợ tối đa 10.000 profile / 5 MB, tự nhập theo từng đợt 500 profile. JSON/CSV/TXT thông thường giữ giới hạn 500 profile / 1 MB. File danh sách không chứa cookie, proxy, API key, cài đặt hay lịch sử.

## Lưu dữ liệu từ bản 0.4.1

App lưu dữ liệu trong SQLite `tool.sqlite` bên ngoài thư mục cài đặt. Mỗi profile có namespace riêng; lịch sử chống gửi trùng, cấu hình và trạng thái chạy được giữ khi cập nhật app. JSON cũ tự chuyển và được giữ dưới tên `state.pre-sqlite.json`. Muốn sao lưu, thoát app trước rồi copy toàn bộ thư mục data. Không ghi lại bằng phiên bản trước 0.4.1 sau khi chuyển SQLite.

## Chạy bằng extension trong app macOS / Windows

1. Trong tab **Profile**, chọn các profile muốn chạy.
2. Lưu API key, model, chủ đề và nhịp chạy ở **Cài đặt** như bình thường.
3. Bấm **Chạy bằng extension**. App đọc profile/proxy từ GPM, tự chuẩn bị extension theo từng profile, nạp extension nếu thiếu rồi bắt đầu chạy. Không cần cài thủ công từ Chrome Web Store.
4. Xem tiến độ, log và lịch sử ở app. Giữ app mở trong suốt quá trình chạy; extension nhận lệnh từ app trên máy này.
5. Bấm **Dừng & đóng** để dừng và đóng profile qua GPM. Dừng trước khi đổi giữa **Chạy tự động** và **Chạy bằng extension**.

Chế độ này dùng cùng bộ logic, AI, cấu hình realtime, giới hạn phiên và SQLite với chế độ chạy hiện tại. Các thao tác tab/DOM, nhập chữ, đính kèm ảnh và bấm nút được thực hiện qua API Chrome của extension. Follow vẫn chỉ ở avatar với xác suất 60%, chờ 210–270 giây sau follow mới, nghỉ vẫn chỉ thả tim ngẫu nhiên 2–5 bài. Không sử dụng bộ chạy độc lập của extension cũ.

App lưu extension trong thư mục dữ liệu riêng của profile, ngoài thư mục cài app. Khi extension thay đổi, app cập nhật các file và nạp lại trước lần chạy tiếp theo. Nếu Chrome đang mở chưa hỗ trợ nạp nóng, app có thể đóng/mở lại đúng profile đã chọn để nạp extension. Nếu GPM/Chrome không cho phép tự nạp extension, app báo lỗi và không tự đổi sang chạy trực tiếp. Cần dùng profile Chrome; Firefox chưa hỗ trợ chế độ này.

**Chạy bằng extension** kiểm tra kết nối extension với app trước, rồi tự mở trang chủ Threads khi bắt đầu phiên. **Mở** riêng vẫn chỉ mở trình duyệt. App cần tiếp tục chạy vì AI, cài đặt và SQLite nằm trong app. Extension kết nối cổng localhost riêng của profile; khi app khởi động lại, bấm Chạy bằng extension trong app để cấp cấu hình kết nối mới. Profile được mở với localhost bỏ qua proxy; lưu lượng Threads vẫn dùng proxy của profile. Nếu không kết nối được, popup hiển thị địa chỉ localhost và hướng dẫn thay cho lỗi `Failed to fetch`. Sau khi cập nhật app, dừng/đóng profile rồi bấm Chạy bằng extension để nạp bản mới.

## Kiểm tra bình luận sau khi gửi

Cả chế độ trực tiếp và extension đều lưu lần bấm Post trước, chờ ngẫu nhiên 25–35 giây rồi tìm bình luận khớp tài khoản/nội dung và lấy link. Khi cần, tool mở lại bài đích để kiểm tra thêm trong khoảng 5 giây. Bình luận đã xác minh có trạng thái `posted`, link bình luận và thời điểm xác minh trong lịch sử. Nếu chưa xác minh được hoặc bước kiểm tra lỗi, giữ `sent_unverified`, ghi lý do rồi tiếp tục nhịp chạy đã cài đặt; không tự gửi lại. Thời gian chờ này được dùng luôn trước khi về trang chủ, không chờ thêm một lượt 30 giây. Nút Dừng vẫn hủy được thời gian chờ.

Link được lấy từ liên kết thời gian của đúng bình luận: đúng tài khoản đang đăng nhập, khớp nội dung, là URL mới và khác URL bài đích. Ảnh có thể tải muộn khi bình luận nằm ngoài vùng nhìn thấy; điều này không chặn lưu permalink đã xác minh. `visible_images` chỉ ghi số ảnh đang thấy trong DOM, không phải số ảnh đã đăng trên máy chủ. Trước Post, tool vẫn kiểm tra đủ ảnh xem trước.

Tool hiện thao tác giao diện Chrome, không gọi endpoint đăng bình luận nội bộ của Threads. [Threads API chính thức của Meta](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) có `reply_to_id` để tạo phản hồi, `threads_publish` để xuất bản và trường `permalink` khi đọc bài/phản hồi, dùng OAuth và Threads access token riêng. API key AI hoặc cookie GPM không phải Threads API access token; tool chưa tích hợp luồng API này.

## Thao tác chuột trong trình duyệt

Cả chạy trực tiếp và chạy bằng extension đều đưa con trỏ qua các điểm trung gian rồi click khi follow, thả tim, mở trả lời, chọn ô nhập, Post và về trang chủ. Các bước tìm bài, đưa nút vào vùng nhìn thấy và cuộn nhẹ khi nghỉ dùng sự kiện bánh xe theo từng đoạn, có khoảng chờ. Tool đo lại vị trí và kiểm tra nút có bị che/disabled trước khi bấm; Dừng hủy thao tác đang di chuyển hoặc cuộn. Di chuyển diễn ra trong trình duyệt của từng profile.

Bình luận có ảnh: đưa chuột đến **Reply** rồi click → nếu có **Expand composer**, đưa chuột đến và mở rộng → click ô nhập và gõ nội dung → gắn cùng lúc 3 ảnh vào input của đúng hộp trả lời → chờ đủ ảnh xem trước và nút Post ổn định. Riêng ảnh được gắn trực tiếp vào input; không bấm Attach media hay mở hộp chọn file của hệ điều hành. Input của composer nhỏ hoặc bài khác ngoài hộp trả lời không được dùng. Tool chỉ di chuột đến Post và bấm sau khi các kiểm tra này đạt.
