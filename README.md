# TeslaBox
Lite, open-source version of [teslarpi.com](https://www.teslarpi.com).

Compresses Tesla dashcam and sentry clips, uploads to S3, notifies of events (along with a copy of each clip) via Telegram and allows remote streaming while parked or driving!

Can also turn your Tesla to a surveillance/security camera, granting access to anyone with a browser.

![](https://cdn.teslarpi.com/assets/img/teslabox.gif)

## Prerequisites
- Raspberry Pi 4 with at least 4GB of ram with case and fan
- Micro-SD card with at least 64GB of storage and card reader
- USB-A to USB-C or USB-C to USB-C (all males) cable
- Some form of WiFi access (preferably in-car)
- [AWS account](https://aws.amazon.com/)
- [Ngrok account](https://ngrok.com/) (preferably paid)
- [Telegram account](https://telegram.org/)

## Installation
For paid (priority) support please contact teslabox@payymail.com

### AWS (required for archiving)
1. Sign into your AWS account
2. Create a new S3 bucket:
   - Bucket name: however you'd like (must be globally unique)
   - AWS region: either us-east-1 or the one closest to you
   - ACL Disabled
   - Block *all* public access
   - Bucket versioning: Disable
   - Default encryption: Disable
   - Click "Create Bucket"
3. Add a new IAM user:
   - User name: whatever you'd like (i.e teslabox)
   - Select AWS credential type: Access key: - Programmatic access
   - Click "Next: Permissions"
   - Under "Attach existing policies directly" click "Create Policy"
   - Service: S3
   - Actions: GetObject and PutObject
   - Resource: Add ARN to restrict access
   - Enter your Bucket name from 2.1. and Object name any
   - Click "Add"
   - Click "Next: Tags"
   - Click "Next: Review"
   - Name: "teslabox"
   - Click "Create Policy"
   - Back on the IAM user page, refresh the list of policies and check "teslabox"
   - Click "Next: Tags"
   - Click "Next: Review"
   - Click "Create User"
   - Copy both the Access key ID and Secret access key

### Ngrok (required for remote access)
1. Sign into your Ngrok account
2. Retrieve your secret token under *Getting Started > Your Authtoken*
3. On paid plans, create your custom domain (you.example.com) or subdomain (you.ngrok.io)

### Telegram (required for notifications)
1. Sign into your Telegram account
2. Search and contact [@Botfather](https://telegram.me/BotFather) user
3. Enter /newbot and follow the wizard to create a new bot and retrieve your secret HTTP API token
4. Contact the new bot you just created and click "Start"
5. Search and contact [@get_id_bot](https://telegram.me/get_id_bot) user
6. Enter anything to retrieve your Chat ID

### Raspberry Pi
1. Download and run [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Write the 32 or 64-bit *Lite* version to your Micro-SD card
3. Re-insert the Micro-SD card and perform the following:

   3.1. Add this to the bottom of **config.txt**:
   ```
   dtoverlay=dwc2
   dtoverlay=disable-bt
   hdmi_blanking=2
   ```

   3.2. Add this after "rootwait" on **cmdline.txt**:
   ```
   modules-load=dwc2
   ```

   3.3. Add an empty **ssh** file (without file extension)

   3.4. Add **wpa_supplicant.conf** file, change your country and list one or more WiFi networks with increasing priority. If I want TeslaBox to prefer my home network, then my USB access point, then my mobile hotspot:
   ```
   ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
   country=US
   update_config=1

   network={
     ssid="my_home_wifi_name"
     psk="my_home_wifi_password"
     priority=3
     id_str="home"
   }

   network={
     ssid="my_usb_ap_wifi_name"
     psk="my_usb_ap_wifi_password"
     priority=2
     id_str="ap"
   }

   network={
     ssid="my_hotspot_wifi_name"
     psk="my_hotspot_wifi_password"
     priority=1
     id_str="hotspot"
   }
   ```
4. Safely eject the Micro-SD card, insert to your Raspberry Pi and boot it up
5. SSH to your Raspberry Pi:
   - IP should be listed on your Router's DHCP client table
   - Username is ```pi```
   - Default password is ```raspberry```
6. Change the default password using ```passwd``` command
7. Perform the following as sudo using ```sudo -i```

   7.1. Allocate USB storage:
   ```
   size="$(($(df --output=avail / | tail -1) - 12000000))"
   fallocate -l "$size"K /usb.bin
   mkdosfs /usb.bin -F 32 -I
   mkdir /mnt/usb
   echo "/usb.bin /mnt/usb vfat noauto,users,umask=000 0 0" >> /etc/fstab

   touch /etc/modprobe.d/g_mass_storage.conf
   echo "options g_mass_storage file=/usb.bin removable=1 ro=0 stall=0 iSerialNumber=123456" >> /etc/modprobe.d/g_mass_storage.conf
   ```
   * 12000000 is 120GB (~93%) of 128GB card (we want around 8GB of unallocated space)
   * Decrease 12000000 to 5600000 for 64GB card
   * Increase 12000000 to 24800000 for 256GB card
   * Increase 12000000 to 50400000 for 512GB card

   7.2. Allocate RAM disk:
   ```
   mkdir /mnt/ram
   echo "tmpfs /mnt/ram tmpfs nodev,nosuid,size=4G 0 0" >> /etc/fstab
   ```
   * 4G (~50%) if you have a Raspberry Pi board with 8GB of ram
   * Decrease 4G to 2G if you have a board with 4GB of ram
   * Decrease 4G to 1G if you have a board with 2GB of ram

   7.3. Run **raspi-config** to set:
   * Variable fan speed (under "Performance") if you have a 3-wires fan
   * Your timezone (under "Localization")
   * Exit without restarting

   7.4. Update system packages, upgrade and install required software:
   ```
   curl -fsSL https://deb.nodesource.com/setup_14.x | sudo -E bash -
   apt update && apt upgrade -y
   apt install -y nodejs python3-pip ffmpeg fonts-freefont-ttf
   pip install tesla_dashcam
   ```

   7.5. Download and install TeslaBox and packages:
   ```
   cd /root
   mkdir -p /root/teslabox
   curl -o main.zip https://codeload.github.com/mluggy/teslabox/zip/refs/heads/main
   unzip -o main.zip
   cp -r teslabox-main/* teslabox
   rm -rf teslabox-main
   cd teslabox
   export NPM_CONFIG_UNSAFE_PERM=true
   npm install
   ```

   7.6. Add this just before "exit 0" in **/etc/rc.local**:
   ```
   /usr/sbin/modprobe g_mass_storage >> /var/log/teslabox.log 2>&1
   ```

   7.7. Create and edit service variables in **/lib/systemd/system/teslabox.service**:
   ```
   [Unit]
   Description=App
   After=network.target

   [Service]
   Environment="NODE_ENV=production"

   # To enable archive, enter these
   Environment="AWS_ACCESS_KEY_ID="
   Environment="AWS_SECRET_ACCESS_KEY="
   Environment="AWS_DEFAULT_REGION="
   Environment="AWS_S3_BUCKET="

   # To enable telegram notification, enter this
   Environment="TELEGRAM_ACCESS_TOKEN="

   # To enable remote access, enter these
   Environment="NGROK_AUTH_TOKEN="
   # Choose the region closest to you (us, eu, ap, au, sa, jp or in)
   Environment="NGROK_REGION=us"

   # To enable remote admin access, enter password
   Environment="ADMIN_PASSWORD="

   # To enable remote public (stream-only) access, enter password (this mustn't be the same as the admin password)
   Environment="PUBLIC_PASSWORD="

   # For paid Ngrok accounts, enter your custom domain ("you.example.com") or subdomain ("you" for you.ngrok.io)
   Environment="ADMIN_HOST="

   # If your run other projects, like Tesla Android, change the port number to avoid conflict
   Environment="ADMIN_PORT=80"

   Type=simple
   User=root
   ExecStart=/usr/bin/node /root/teslabox/src/index.js
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   7.8. Install the service to start at every boot:
   ```
   systemctl daemon-reload
   systemctl enable teslabox
   systemctl start teslabox
   systemctl status teslabox
   ```
   If the status is Green and shows active (running), continue to setup

## Setup

### Initial setup
1. Connect TeslaBox to your computer via USB cable and wait for it to appear as drive
2. Create an empty ```TeslaCam``` under the root folder of the drive
3. Make sure TeslaBox is connected to your home network via ethernet cable or home WiFi
4. Browse your device IP address and edit these settings:

- Car name (appears next to each notification)
- Log level (log verbosity. recommended: Debug)
- Archive (enables archiving)
- Archive seconds (the longer you set this, the more time and space each clip would take to process. recommended: 30)
- Archive quality (the higher you set this, the more space each clip would take. recommended: Lowest)
- Archive compression (the slower you set this, the less space each clip would take, but also the longer it take to process. recommended: Very fast)
- Telegram recipients (comma seperated list of chat IDs that should be notified. recommended: your Telegram Chat ID)
- Stream (enables streaming)
- SSH (enables remote shell access)
- Public (enables remote public streaming)

### In-car connectivity
TeslaBox works best with in-car WiFi. I personally use a 4G USB access point plugged into the main console with a short USB-A (female) to USB-C (male) cable. You can also use your mobile WiFi hotspot, or wait for the car to use your home WiFi as you park.

### Admin access
This works if you entered admin password. Settings are explained above under Initial setup. To logout, click the "Logout" icon at the bottom.

### Public access
This works if you entered public password. It will restrict public access to stream view only. To logout, click the "Logout" button at the top.

## Usage

### Dashcam
Tesla would recognize the TeslaBox as standard USB. You can click save, honk or use voice commands to capture dashcam clips normaly. Just make sure the TeslaBox is connected properly and the "Record/ing" has a Red dot on the car quick-settings screen.

If archive is enabled, clips will be uploaded to S3 and a copy of each clip (along with the event location) will be sent to your Telegram (assuming you have it set up).

The clip would start X seconds prior to the event ("red dot"). X is settable under *Admin > Archive seconds*.

### Sentry
If archive is enabled and sentry mode is activated, then similarly to dashcam every clip will be uploaded to S3 and/or sent to your Telegram.

The clip would start X/2 seconds prior to the event ("red dot") and X/2 seconds following the event. X is settable under *Admin > Archive seconds*.

If the event is sensed on the rear, then the back camera is enlarged, otherwise - front. The side cameras are always smaller.

### Raw footage
Dashcam and sentry videos are always available through the Dashcam app on your Tesla, or by connecting TeslaBox using USB cable to your computer.

### Stream
This is similar to Tesla's Sentry Mode Live Camera feature but available on any browser. To some extent, you can use it as a public security camera.

There is, however, a 1 minute delay for each clip which is the time it takes to close and prepare the file. You can switch between different angles. Video would automatically progress to the next minute when it is done playing.

If sentry mode is disabled or car is asleep, you might not see any new streams.

This feature is automatically disabled when the car goes to sleep or TeslaBox restarts.

## Important considerations
TeslaBox neither use any Tesla API nor requires any Tesla token. It only replaces your Tesla's standard USB or SSD drive with
Micro-SD card on a Raspberry Pi.

You can delete individual (or all) videos under "Safety" or through the Dashcam app on your Tesla, but do **not** format the drive. It will render the TeslaBox useless.

There might be risks involved with running TeslaBox under certain tempature conditions, TeslaBox not recording dashcam or sentry videos and/or TeslaBox not uploading, delivering or notifying you of such events. Always make sure Tesla recognizes a valid USB storage, and that videos are saved and viewable through the built-in Dashcam app.

There might be AWS costs associated with archiving (both storing and viewing clips). See [S3 pricing](https://aws.amazon.com/s3/pricing/).

There might be 3G/4G bandwidth costs associated with your WiFi connectivity. If you are worried you can have TeslaBox connect only to your home or public WiFi.

## Upgrade

1. SSH to your Raspberry Pi
2. Perform the following as sudo using ```sudo -i```

   2.1. Download and re-install TeslaBox and packages:
   ```
   cd /root
   curl -o main.zip https://codeload.github.com/mluggy/teslabox/zip/refs/heads/main
   unzip -o main.zip
   cp -r teslabox-main/* teslabox
   rm -rf teslabox-main
   cd teslabox
   export NPM_CONFIG_UNSAFE_PERM=true
   npm install
   ```

   2.2. Restart TeslaBox service:
   ```
   systemctl restart teslabox
   ```

## Support
TeslaBox is not affiliated or supported by Tesla. There is no official support whatsoever. As per the license this is provided As-Is. **Use at your own risk!**

Please open an issue if things seems out of order and I'll attend them as time allows.

## Credits
TeslaBox wouldn't become available without the help of [teslausb](https://github.com/marcone/teslausb), [tesla_dashcam](https://github.com/ehendrix23/tesla_dashcam) and friends at [TeslaFansIL](https://t.me/TeslaFansIL).
